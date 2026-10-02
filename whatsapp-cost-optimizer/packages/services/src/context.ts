import type { Redis } from "ioredis";
import { loadConfig, type AppConfig } from "@wco/config";
import { getDb, loadPolicyDefinitions, loadRateCatalog, type Db } from "@wco/database";
import { BillingCategory, type Role } from "@wco/domain";
import { getLogger, metrics, type Logger } from "@wco/logging";
import { DEFAULT_OPTIMIZATION_POLICIES, DEFAULT_RULESET, PolicyEngine, type OptimizationPolicyConfig, type RuleSet } from "@wco/policy";
import { CostEngine, PolicyRegistry, setUnknownPricingHook } from "@wco/pricing";
import type { TemplateInfo } from "@wco/optimization";
import { MetaCloudApiProvider, MockWhatsAppProvider, type WhatsAppProvider } from "@wco/whatsapp";
import { createQueues, createRedis, QUEUE, type Queues } from "./queues";
import { Vault } from "./vault";

export const CHANNEL_PRICING = "wco:pricing:changed";
export const CHANNEL_TENANT = "wco:tenant:changed";

/** Pricing policies and rate cards are cacheable (spec §54); invalidated on change via Redis pub/sub. */
export class PricingStore {
  private cached?: { engine: CostEngine; at: number };
  private loading?: Promise<CostEngine>;
  constructor(
    private readonly db: Db,
    private readonly ttlMs = 60_000,
  ) {}

  async engine(): Promise<CostEngine> {
    if (this.cached && Date.now() - this.cached.at < this.ttlMs) return this.cached.engine;
    if (!this.loading) {
      this.loading = (async () => {
        const [defs, catalog] = await Promise.all([loadPolicyDefinitions(this.db), loadRateCatalog(this.db)]);
        const engine = new CostEngine(new PolicyRegistry(defs), catalog);
        this.cached = { engine, at: Date.now() };
        return engine;
      })().finally(() => {
        this.loading = undefined;
      });
    }
    return this.loading;
  }

  invalidate(): void {
    this.cached = undefined;
  }
}

export interface TemplateConfig extends TemplateInfo {
  id: string;
  parameterFormat: "NAMED" | "POSITIONAL";
}

export interface WabaConfig {
  id: string;
  metaWabaId: string;
  businessAccountId: string;
  timezone: string;
  currency: string;
  provider: "MOCK" | "META_CLOUD_API";
  accessTokenEncrypted: string | null;
  authInternationalEligible: boolean;
}

export interface PhoneConfig {
  id: string;
  metaPhoneNumberId: string;
  wabaId: string;
  displayPhoneNumber: string;
  isDefault: boolean;
  throughputMps: number;
}

export interface TenantConfig {
  id: string;
  slug: string;
  requireOptIn: boolean;
  usesBsp: boolean;
  bspFeeModel: Record<string, unknown> | null;
  defaultCurrency: string;
  defaultTimezone: string;
  policies: OptimizationPolicyConfig[];
  rules: PolicyEngine;
  ruleSet: RuleSet;
  templates: Map<string, TemplateConfig>;
  phones: PhoneConfig[];
  wabas: Map<string, WabaConfig>;
}

/** Business configuration and template metadata are cacheable; permissions/security state are NOT (spec §54). */
export class TenantConfigCache {
  private readonly cache = new Map<string, { cfg: TenantConfig; at: number }>();
  constructor(
    private readonly db: Db,
    private readonly ttlMs = 30_000,
  ) {}

  invalidate(tenantId?: string): void {
    if (tenantId) this.cache.delete(tenantId);
    else this.cache.clear();
  }

  async get(tenantId: string): Promise<TenantConfig> {
    const hit = this.cache.get(tenantId);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.cfg;
    const [tenant, policies, ruleSet, templates, phones, wabas] = await Promise.all([
      this.db.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
      this.db.optimizationPolicy.findMany({ where: { tenantId } }),
      this.db.policyRuleSet.findFirst({ where: { tenantId, active: true }, orderBy: { updatedAt: "desc" } }),
      this.db.template.findMany({ where: { tenantId } }),
      this.db.phoneNumber.findMany({ where: { tenantId }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] }),
      this.db.waba.findMany({ where: { tenantId } }),
    ]);
    const rs: RuleSet = ruleSet ? PolicyEngine.validate(ruleSet.rules) : DEFAULT_RULESET;
    const cfg: TenantConfig = {
      id: tenant.id,
      slug: tenant.slug,
      requireOptIn: tenant.requireOptIn,
      usesBsp: tenant.usesBsp,
      bspFeeModel: (tenant.bspFeeModel as Record<string, unknown> | null) ?? null,
      defaultCurrency: tenant.defaultCurrency,
      defaultTimezone: tenant.defaultTimezone,
      policies: policies.length
        ? policies.map((p) => ({
            eventType: p.eventType,
            maxDelaySeconds: p.maxDelaySeconds,
            debounceSeconds: p.debounceSeconds,
            allowAggregation: p.allowAggregation,
            allowSupersession: p.allowSupersession,
            allowDeduplication: p.allowDeduplication,
            dedupWindowSeconds: p.dedupWindowSeconds,
            priority: p.priority,
            requiresImmediateDelivery: p.requiresImmediateDelivery,
            supersessionGroup: p.supersessionGroup,
            consolidationTemplate: p.consolidationTemplate,
            defaultTemplate: p.defaultTemplate,
            defaultLanguage: p.defaultLanguage,
            category: p.category,
            allowFreeFormInWindow: p.allowFreeFormInWindow,
            maxConsolidatedItems: p.maxConsolidatedItems,
            enabled: p.enabled,
          }))
        : DEFAULT_OPTIMIZATION_POLICIES,
      rules: new PolicyEngine(rs),
      ruleSet: rs,
      templates: new Map(
        templates.map((t) => {
          const comps = t.components as Array<{ type?: string; params?: string[]; parameterFormat?: string }>;
          const body = Array.isArray(comps) ? comps.find((c) => (c.type ?? "").toUpperCase() === "BODY") : undefined;
          const category = (t.metaCategory ?? t.declaredCategory) as unknown as BillingCategory;
          return [
            t.name,
            {
              id: t.id,
              name: t.name,
              language: t.language,
              category,
              approved: t.status === "APPROVED",
              consolidationParam: t.consolidationParam,
              maxParamLength: t.maxParamLength,
              bodyParams: body?.params ?? [],
              parameterFormat: body?.parameterFormat === "POSITIONAL" ? "POSITIONAL" : "NAMED",
            } satisfies TemplateConfig,
          ];
        }),
      ),
      phones: phones.map((p) => ({ id: p.id, metaPhoneNumberId: p.metaPhoneNumberId, wabaId: p.wabaId, displayPhoneNumber: p.displayPhoneNumber, isDefault: p.isDefault, throughputMps: p.throughputMps })),
      wabas: new Map(
        wabas.map((w) => [
          w.id,
          {
            id: w.id,
            metaWabaId: w.metaWabaId,
            businessAccountId: w.businessAccountId,
            timezone: w.timezone,
            currency: w.currency,
            provider: w.provider,
            accessTokenEncrypted: w.accessTokenEncrypted,
            authInternationalEligible: w.authInternationalEligible,
          },
        ]),
      ),
    };
    this.cache.set(tenantId, { cfg, at: Date.now() });
    return cfg;
  }
}

export interface Actor {
  type: "USER" | "API_KEY" | "SYSTEM";
  id: string | null;
  tenantId: string;
  role: Role;
}

export interface AppContext {
  config: AppConfig;
  db: Db;
  redis: Redis;
  queues: Queues;
  vault: Vault;
  pricing: PricingStore;
  tenants: TenantConfigCache;
  log: Logger;
  provider(waba: WabaConfig | null): WhatsAppProvider;
  now(): Date;
  close(): Promise<void>;
}

export function createAppContext(opts: { config?: AppConfig; service: string; subscribe?: boolean } ): AppContext {
  const config = opts.config ?? loadConfig();
  const db = getDb(config.env.DATABASE_URL, config.env.DATABASE_POOL_MAX);
  const redis = createRedis(config.env.REDIS_URL);
  const queues = createQueues(redis);
  const pricing = new PricingStore(db);
  const tenants = new TenantConfigCache(db);
  const log = getLogger(opts.service);
  setUnknownPricingHook((reason) => metrics.costCalculationErrors.inc({ reason }));

  let subscriber: Redis | undefined;
  if (opts.subscribe !== false) {
    subscriber = createRedis(config.env.REDIS_URL);
    void subscriber.subscribe(CHANNEL_PRICING, CHANNEL_TENANT);
    subscriber.on("message", (channel, message) => {
      if (channel === CHANNEL_PRICING) pricing.invalidate();
      if (channel === CHANNEL_TENANT) tenants.invalidate(message || undefined);
    });
  }

  const mock = new MockWhatsAppProvider({
    appSecret: config.meta.appSecret ?? "wco-dev-app-secret",
    wabaId: config.meta.devCredentials.wabaId ?? "mock-waba",
    deliveryRate: config.env.MOCK_DELIVERY_RATE,
    readRate: config.env.MOCK_READ_RATE,
    maxLatencyMs: config.env.MOCK_MAX_LATENCY_MS,
    emit: async (payload, delayMs) => {
      await queues[QUEUE.MOCK_EMIT].add("emit", { payload }, { delay: delayMs });
    },
  });
  let meta: MetaCloudApiProvider | undefined;
  const provider = (waba: WabaConfig | null): WhatsAppProvider => {
    if (config.meta.mock || !waba || waba.provider === "MOCK") return mock;
    if (!meta) {
      meta = new MetaCloudApiProvider({
        graphApiVersion: config.meta.graphApiVersion!,
        baseUrl: config.meta.graphApiBaseUrl,
        appSecret: config.meta.appSecret,
        timeoutMs: config.meta.timeoutMs,
      });
    }
    return meta;
  };

  return {
    config,
    db,
    redis,
    queues,
    vault: new Vault(config.encryptionKey, config.hashPepper),
    pricing,
    tenants,
    log,
    provider,
    now: () => new Date(),
    async close() {
      await Promise.allSettled(Object.values(queues).map((q) => q.close()));
      await subscriber?.quit().catch(() => undefined);
      await redis.quit().catch(() => undefined);
      await db.$disconnect();
    },
  };
}

export async function publishPricingChanged(ctx: AppContext): Promise<void> {
  ctx.pricing.invalidate();
  await ctx.redis.publish(CHANNEL_PRICING, "1");
}

export async function publishTenantChanged(ctx: AppContext, tenantId: string): Promise<void> {
  ctx.tenants.invalidate(tenantId);
  await ctx.redis.publish(CHANNEL_TENANT, tenantId);
}
