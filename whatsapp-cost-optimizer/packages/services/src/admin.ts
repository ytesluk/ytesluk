import { z } from "zod";
import { AlertSeverity, AlertType, Errors, PRIORITIES, TemplateCategory, money } from "@wco/domain";
import { loadRateCatalog, saveRateCard, upsertPolicyDefinition } from "@wco/database";
import { analyzeCategory, analyzeTemplateCost, templateText, FINAL_CATEGORY_DISCLAIMER } from "@wco/optimization";
import { PolicyEngine, RuleSetSchema } from "@wco/policy";
import { importRateCard, type PolicyDefinition } from "@wco/pricing";
import { audit, raiseAlert } from "./audit";
import { publishPricingChanged, publishTenantChanged, type Actor, type AppContext } from "./context";

// ------------------------------------------------------------------------------------------- pricing

export async function listPricing(ctx: AppContext) {
  const [policies, imports] = await Promise.all([
    ctx.db.pricingPolicyVersion.findMany({ orderBy: { effectiveFrom: "asc" }, include: { rules: true } }),
    ctx.db.priceCatalogImport.findMany({ orderBy: [{ currency: "asc" }, { effectiveFrom: "asc" }], include: { rows: { orderBy: [{ market: "asc" }, { category: "asc" }, { tierStart: "asc" }] } } }),
  ]);
  return {
    policies: policies.map((p) => ({
      id: p.id,
      name: p.name,
      effectiveFrom: p.effectiveFrom.toISOString().slice(0, 10),
      effectiveUntil: p.effectiveUntil?.toISOString().slice(0, 10) ?? null,
      status: p.status,
      sourceUrl: p.sourceUrl,
      sourceCheckedAt: p.sourceCheckedAt,
      sourceHash: p.sourceHash,
      notes: p.notes,
      sources: (p.definition as unknown as PolicyDefinition).sources,
      rules: p.rules.map((r) => ({ market: r.market, category: r.messageCategory, billable: r.billable, freeEligibility: r.freeEligibility, freeQuota: r.freeQuota, freeQuotaScope: r.freeQuotaScope, tiered: r.tiered, requiresCustomerServiceWindow: r.requiresCustomerServiceWindow, customerServiceWindowHours: r.customerServiceWindowHours, freeEntryPointWindowHours: r.freeEntryPointWindowHours })),
    })),
    rateCards: imports.map((i) => ({
      id: i.id,
      name: i.name,
      currency: i.currency,
      effectiveFrom: i.effectiveFrom.toISOString().slice(0, 10),
      effectiveUntil: i.effectiveUntil?.toISOString().slice(0, 10) ?? null,
      status: i.status,
      isDemo: i.isDemo,
      sourceUrl: i.sourceUrl,
      sourceDocument: i.sourceDocument,
      checksum: i.checksum,
      importedAt: i.importedAt,
      marketAliases: i.marketAliases,
      rows: i.rows.map((r) => ({ market: r.market, category: r.category, tierStart: r.tierStart, tierEnd: r.tierEnd, unitRate: r.unitRate.toString() })),
    })),
    disclaimer: "Rate cards DEMO contêm valores fictícios, apenas para desenvolvimento — não são tarifas da Meta.",
  };
}

export const PricingImportSchema = z.object({
  content: z.string().min(2).max(5_000_000),
  tiersContent: z.string().max(5_000_000).optional(),
  name: z.string().min(1).optional(),
  currency: z.string().length(3).optional(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  effectiveUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  sourceUrl: z.string().min(1).optional(),
  sourceDocument: z.string().min(1).optional(),
  dryRun: z.boolean().default(false),
});

export async function importPricing(ctx: AppContext, actor: Actor | null, raw: unknown) {
  const input = PricingImportSchema.parse(raw);
  const result = importRateCard(
    input.content,
    { name: input.name, currency: input.currency, effectiveFrom: input.effectiveFrom, effectiveUntil: input.effectiveUntil ?? null, sourceUrl: input.sourceUrl, sourceDocument: input.sourceDocument },
    input.tiersContent,
  );
  const summary = { ok: result.ok, format: result.format, rows: result.rows.length, tiers: result.tiers.length, checksum: result.checksum, issues: result.issues.slice(0, 200), currency: result.card?.meta.currency ?? null };
  if (!result.ok || input.dryRun) return { ...summary, saved: false };
  const before = await loadRateCatalog(ctx.db);
  const saved = await saveRateCard(ctx.db, result, { importedBy: actor?.id ?? "cli" });
  await audit(ctx.db, { tenantId: null, actor, action: "pricing.imported", entityType: "PriceCatalogImport", entityId: saved.id, data: { ...summary, issues: undefined } });
  if (saved.created) {
    // PRICE_CHANGED alert for every tenant billing in this currency (spec §93).
    const tenants = await ctx.db.tenant.findMany({ where: { wabas: { some: { currency: result.card!.meta.currency } } }, select: { id: true } });
    for (const t of tenants) {
      await raiseAlert(ctx.db, {
        tenantId: t.id,
        type: AlertType.PRICE_CHANGED,
        severity: AlertSeverity.INFO,
        title: `Novo rate card ${result.card!.meta.name}`,
        message: `Rate card ${result.card!.meta.currency} vigente a partir de ${result.card!.meta.effectiveFrom} importado (${result.rows.length} linhas). Rate cards anteriores: ${before.cards.filter((c) => c.meta.currency === result.card!.meta.currency).length}.`,
        dedupKey: `price:${t.id}:${result.checksum}`,
      });
    }
    await publishPricingChanged(ctx);
  }
  return { ...summary, saved: true, id: saved.id, created: saved.created };
}

export async function setRateCardStatus(ctx: AppContext, actor: Actor, id: string, status: "ACTIVE" | "RETIRED") {
  const row = await ctx.db.priceCatalogImport.update({ where: { id }, data: { status } });
  await audit(ctx.db, { tenantId: null, actor, action: "pricing.status", entityType: "PriceCatalogImport", entityId: id, data: { status } });
  await publishPricingChanged(ctx);
  return { id: row.id, status: row.status };
}

export async function addPolicyVersion(ctx: AppContext, actor: Actor, def: PolicyDefinition) {
  const r = await upsertPolicyDefinition(ctx.db, def);
  await audit(ctx.db, { tenantId: null, actor, action: "pricing.policy.added", entityType: "PricingPolicyVersion", entityId: def.id, data: { status: def.status, effectiveFrom: def.effectiveFrom } });
  if (r.created) {
    const tenants = await ctx.db.tenant.findMany({ select: { id: true } });
    for (const t of tenants) await raiseAlert(ctx.db, { tenantId: t.id, type: AlertType.POLICY_CHANGED, severity: AlertSeverity.INFO, title: `Nova política de preço ${def.id}`, message: `${def.name} (${def.status}) a partir de ${def.effectiveFrom}.`, dedupKey: `policy:${t.id}:${def.id}` });
    await publishPricingChanged(ctx);
  }
  return r;
}

// ------------------------------------------------------------------------------------------- templates

export const TemplateSchema = z.object({
  name: z.string().regex(/^[a-z0-9_]{1,512}$/, "lowercase letters, numbers and underscores"),
  language: z.string().min(2).max(10),
  declaredCategory: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]),
  metaCategory: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]).optional(),
  status: z.enum(["DRAFT", "PENDING", "APPROVED", "REJECTED", "PAUSED", "DISABLED"]).default("DRAFT"),
  body: z.string().min(1).max(1024),
  bodyParams: z.array(z.string().min(1)).default([]),
  parameterFormat: z.enum(["NAMED", "POSITIONAL"]).default("NAMED"),
  consolidationParam: z.string().optional(),
  externalId: z.string().optional(),
  quality: z.string().optional(),
});

export async function upsertTemplate(ctx: AppContext, actor: Actor, raw: unknown) {
  const input = TemplateSchema.parse(raw);
  const analysis = analyzeCategory(input.body);
  const components = [{ type: "BODY", text: input.body, params: input.bodyParams, parameterFormat: input.parameterFormat }];
  const data = {
    declaredCategory: input.declaredCategory,
    metaCategory: input.metaCategory ?? null,
    status: input.status,
    components,
    consolidationParam: input.consolidationParam ?? null,
    externalId: input.externalId ?? null,
    quality: input.quality ?? null,
    analyzedCategory: analysis.category === "SERVICE" ? null : analysis.category,
    classificationConfidence: analysis.classificationConfidence.toFixed(4),
    requiresHumanReview: analysis.requiresHumanReview,
    analysisNotes: { notes: analysis.notes, signals: analysis.signals, disclaimer: FINAL_CATEGORY_DISCLAIMER },
    approvedAt: input.status === "APPROVED" ? ctx.now() : null,
  };
  const row = await ctx.db.template.upsert({
    where: { tenantId_name_language: { tenantId: actor.tenantId, name: input.name, language: input.language } },
    create: { tenantId: actor.tenantId, name: input.name, language: input.language, ...data },
    update: data,
  });
  await audit(ctx.db, { tenantId: actor.tenantId, actor, action: "template.upserted", entityType: "Template", entityId: row.id, data: { name: input.name, declaredCategory: input.declaredCategory, analyzed: analysis.category } });
  await publishTenantChanged(ctx, actor.tenantId);
  return { ...row, classificationConfidence: row.classificationConfidence?.toString() ?? null, analysis };
}

export async function listTemplates(ctx: AppContext, tenantId: string) {
  const rows = await ctx.db.template.findMany({ where: { tenantId }, orderBy: [{ name: "asc" }, { language: "asc" }] });
  return rows.map((r) => ({ ...r, classificationConfidence: r.classificationConfidence?.toString() ?? null, body: templateText(r.components) }));
}

export const TemplateCostSchema = z.object({
  templateId: z.string().optional(),
  body: z.string().optional(),
  declaredCategory: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]).optional(),
  market: z.string().default("BR"),
  currency: z.string().length(3).optional(),
  monthlyVolume: z.number().int().min(1).max(100_000_000).default(10_000),
  date: z.coerce.date().optional(),
});

/** Template Cost Analyzer (spec §65) — never modifies a template, never suggests wording to change category. */
export async function templateCost(ctx: AppContext, tenantId: string, raw: unknown) {
  const input = TemplateCostSchema.parse(raw);
  const tenant = await ctx.tenants.get(tenantId);
  let components: unknown = input.body ?? "";
  let declared = (input.declaredCategory ?? "MARKETING") as TemplateCategory;
  let metaCategory: TemplateCategory | null = null;
  if (input.templateId) {
    const t = await ctx.db.template.findFirst({ where: { id: input.templateId, tenantId } });
    if (!t) throw Errors.notFound("Template");
    components = t.components;
    declared = t.declaredCategory as TemplateCategory;
    metaCategory = (t.metaCategory as TemplateCategory | null) ?? null;
  }
  const engine = await ctx.pricing.engine();
  return analyzeTemplateCost(
    { components, declaredCategory: declared, metaCategory, market: input.market, currency: input.currency ?? tenant.defaultCurrency, monthlyVolume: input.monthlyVolume, date: input.date ?? ctx.now(), timezone: tenant.defaultTimezone },
    engine,
  );
}

/**
 * Optional "Template Classification Assistant" (spec §18). Disabled by default; never called in the
 * message hot path; never decides the billable category; results cached per template content; cost
 * of every call recorded in AiUsage. No AI provider is bundled — the hook below documents the contract.
 */
export async function classificationAssistant(ctx: AppContext, actor: Actor, templateId: string) {
  if (!ctx.config.env.AI_ASSISTANT_ENABLED) {
    return { enabled: false, message: "O Template Classification Assistant está desativado (AI_ASSISTANT_ENABLED=false). O analisador determinístico continua disponível." };
  }
  const t = await ctx.db.template.findFirst({ where: { id: templateId, tenantId: actor.tenantId } });
  if (!t) throw Errors.notFound("Template");
  const cacheKey = `wco:ai:${t.id}:${t.updatedAt.getTime()}`;
  const cached = await ctx.redis.get(cacheKey);
  if (cached) {
    await ctx.db.aiUsage.create({ data: { tenantId: actor.tenantId, templateId: t.id, provider: ctx.config.env.AI_ASSISTANT_PROVIDER ?? "none", model: ctx.config.env.AI_ASSISTANT_MODEL ?? "none", cached: true, cost: "0", currency: "USD" } });
    return { enabled: true, cached: true, ...(JSON.parse(cached) as object) };
  }
  // Provider integration intentionally not bundled: plug a client here (provider/model/key from env).
  const deterministic = analyzeCategory(templateText(t.components));
  const result = { suggestion: deterministic.category, confidence: deterministic.classificationConfidence, notes: deterministic.notes, disclaimer: FINAL_CATEGORY_DISCLAIMER, provider: "deterministic-fallback" };
  await ctx.redis.set(cacheKey, JSON.stringify(result), "EX", 30 * 86_400);
  await ctx.db.aiUsage.create({ data: { tenantId: actor.tenantId, templateId: t.id, provider: ctx.config.env.AI_ASSISTANT_PROVIDER ?? "none", model: ctx.config.env.AI_ASSISTANT_MODEL ?? "none", cached: false, cost: money(ctx.config.env.AI_ASSISTANT_COST_PER_CALL).toFixed(8), currency: "USD" } });
  return { enabled: true, cached: false, ...result };
}

// ------------------------------------------------------------------------------------------- optimization policies

export const OptimizationPolicySchema = z.object({
  eventType: z.string().min(1).max(120),
  maxDelaySeconds: z.number().int().min(0).max(7 * 86_400).default(0),
  debounceSeconds: z.number().int().min(0).max(86_400).default(0),
  allowAggregation: z.boolean().default(false),
  allowSupersession: z.boolean().default(false),
  allowDeduplication: z.boolean().default(true),
  dedupWindowSeconds: z.number().int().min(0).max(30 * 86_400).default(86_400),
  priority: z.enum(PRIORITIES as [string, ...string[]]).default("NORMAL"),
  requiresImmediateDelivery: z.boolean().default(false),
  supersessionGroup: z.string().nullable().optional(),
  consolidationTemplate: z.string().nullable().optional(),
  defaultTemplate: z.string().nullable().optional(),
  defaultLanguage: z.string().default("pt_BR"),
  category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION", "SERVICE"]).nullable().optional(),
  allowFreeFormInWindow: z.boolean().default(false),
  maxConsolidatedItems: z.number().int().min(1).max(50).default(10),
  enabled: z.boolean().default(true),
});

export async function listOptimizationPolicies(ctx: AppContext, tenantId: string) {
  const [policies, ruleSets] = await Promise.all([
    ctx.db.optimizationPolicy.findMany({ where: { tenantId }, orderBy: { eventType: "asc" } }),
    ctx.db.policyRuleSet.findMany({ where: { tenantId }, orderBy: { updatedAt: "desc" } }),
  ]);
  return { policies, ruleSets };
}

export async function upsertOptimizationPolicy(ctx: AppContext, actor: Actor, raw: unknown) {
  const input = OptimizationPolicySchema.parse(raw);
  const data = { ...input, priority: input.priority as never, category: (input.category ?? null) as never };
  const row = await ctx.db.optimizationPolicy.upsert({
    where: { tenantId_eventType: { tenantId: actor.tenantId, eventType: input.eventType } },
    create: { tenantId: actor.tenantId, ...data },
    update: data,
  });
  await audit(ctx.db, { tenantId: actor.tenantId, actor, action: "policy.optimization.updated", entityType: "OptimizationPolicy", entityId: row.id, data: input });
  await publishTenantChanged(ctx, actor.tenantId);
  return row;
}

export async function upsertRuleSet(ctx: AppContext, actor: Actor, raw: unknown) {
  const rs = RuleSetSchema.parse(raw);
  new PolicyEngine(rs); // validates
  await ctx.db.policyRuleSet.updateMany({ where: { tenantId: actor.tenantId }, data: { active: false } });
  const row = await ctx.db.policyRuleSet.upsert({
    where: { tenantId_name: { tenantId: actor.tenantId, name: rs.name } },
    create: { tenantId: actor.tenantId, name: rs.name, rules: rs as never, active: true },
    update: { rules: rs as never, active: true },
  });
  await audit(ctx.db, { tenantId: actor.tenantId, actor, action: "policy.ruleset.updated", entityType: "PolicyRuleSet", entityId: row.id, data: { name: rs.name, rules: rs.rules.length } });
  await publishTenantChanged(ctx, actor.tenantId);
  return row;
}

// ------------------------------------------------------------------------------------------- tenant

export const TenantSettingsSchema = z.object({
  name: z.string().min(1).optional(),
  requireOptIn: z.boolean().optional(),
  usesBsp: z.boolean().optional(),
  bspFeeModel: z
    .object({
      type: z.enum(["NONE", "PERCENTAGE", "FIXED_PER_MESSAGE", "MONTHLY", "MIXED"]),
      percentOfMeta: z.string().optional(),
      perMessage: z.string().optional(),
      perMessageAppliesTo: z.enum(["ALL_SENT", "BILLABLE_ONLY"]).optional(),
      monthlyFee: z.string().optional(),
      label: z.string().optional(),
    })
    .nullable()
    .optional(),
  defaultTimezone: z.string().optional(),
});

export async function getTenant(ctx: AppContext, tenantId: string) {
  const t = await ctx.db.tenant.findUniqueOrThrow({ where: { id: tenantId }, include: { subscription: true, retentionPolicy: true } });
  const [wabas, phones, users] = await Promise.all([
    ctx.db.waba.findMany({ where: { tenantId }, select: { id: true, metaWabaId: true, name: true, timezone: true, currency: true, provider: true, validatedAt: true, webhookSubscribedAt: true, authInternationalEligible: true } }),
    ctx.db.phoneNumber.findMany({ where: { tenantId }, select: { id: true, metaPhoneNumberId: true, displayPhoneNumber: true, verifiedName: true, qualityRating: true, throughputMps: true, status: true, isDefault: true } }),
    ctx.db.user.count({ where: { tenantId } }),
  ]);
  return { ...t, wabas, phones, users };
}

export async function updateTenant(ctx: AppContext, actor: Actor, raw: unknown) {
  const input = TenantSettingsSchema.parse(raw);
  const row = await ctx.db.tenant.update({ where: { id: actor.tenantId }, data: { ...input, bspFeeModel: input.bspFeeModel === undefined ? undefined : (input.bspFeeModel as never) } });
  await audit(ctx.db, { tenantId: actor.tenantId, actor, action: "tenant.updated", entityType: "Tenant", entityId: row.id, data: input });
  await publishTenantChanged(ctx, actor.tenantId);
  return row;
}

/** Platform view (PLATFORM_ADMIN_EMAILS only): aggregated per-tenant numbers, no personal data. */
export async function platformTenants(ctx: AppContext) {
  const rows = await ctx.db.$queryRaw<Array<{ id: string; slug: string; name: string; intents: bigint; avoided: bigint; savings: string | null }>>`
    SELECT t.id, t.slug, t.name,
      (SELECT COUNT(*) FROM "MessageIntent" i WHERE i."tenantId" = t.id) AS intents,
      (SELECT COUNT(*) FROM "MessageIntent" i WHERE i."tenantId" = t.id AND i.status IN ('DEDUPLICATED','SUPERSEDED','CONSOLIDATED')) AS avoided,
      (SELECT SUM(s.savings)::text FROM "SavingsRecord" s WHERE s."tenantId" = t.id AND s.kind = 'META') AS savings
    FROM "Tenant" t ORDER BY t."createdAt"`;
  return rows.map((r) => ({ id: r.id, slug: r.slug, name: r.name, intents: Number(r.intents), avoided: Number(r.avoided), metaSavingsEstimated: r.savings ?? "0" }));
}

// ------------------------------------------------------------------------------------------- webhooks / audit / alerts admin

export async function listWebhookEvents(ctx: AppContext, tenantId: string, q: { status?: string; limit?: number }) {
  return ctx.db.webhookEvent.findMany({
    where: { tenantId, ...(q.status ? { status: q.status as never } : {}) },
    orderBy: { receivedAt: "desc" },
    take: Math.min(q.limit ?? 50, 200),
    select: { id: true, provider: true, field: true, status: true, attempts: true, error: true, receivedAt: true, processedAt: true, signatureValid: true, rawPurgedAt: true },
  });
}

export async function listAudit(ctx: AppContext, tenantId: string, q: { entityType?: string; entityId?: string; limit?: number }) {
  return ctx.db.auditLog.findMany({ where: { tenantId, ...(q.entityType ? { entityType: q.entityType } : {}), ...(q.entityId ? { entityId: q.entityId } : {}) }, orderBy: { createdAt: "desc" }, take: Math.min(q.limit ?? 100, 500) });
}

export async function listAlerts(ctx: AppContext, tenantId: string) {
  return ctx.db.alert.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 100 });
}

export async function acknowledgeAlert(ctx: AppContext, actor: Actor, id: string) {
  const a = await ctx.db.alert.findFirst({ where: { id, tenantId: actor.tenantId } });
  if (!a) throw Errors.notFound("Alert");
  await audit(ctx.db, { tenantId: actor.tenantId, actor, action: "alert.acknowledged", entityType: "Alert", entityId: id });
  return ctx.db.alert.update({ where: { id }, data: { acknowledgedAt: ctx.now() } });
}

export async function listConversations(ctx: AppContext, tenantId: string, q: { limit?: number }) {
  const rows = await ctx.db.conversation.findMany({
    where: { tenantId },
    orderBy: { updatedAt: "desc" },
    take: Math.min(q.limit ?? 50, 200),
    include: { customer: { select: { phoneMasked: true } }, window: true, entryPoints: { orderBy: { userMessageAt: "desc" }, take: 3 } },
  });
  const now = ctx.now();
  return rows.map((c) => ({
    id: c.id,
    customer: c.customer.phoneMasked,
    phoneNumberId: c.phoneNumberId,
    lastInboundAt: c.lastInboundAt,
    lastOutboundAt: c.lastOutboundAt,
    customerServiceWindow: c.window ? { lastInboundMessageAt: c.window.lastInboundMessageAt, expiresAt: c.window.expiresAt, open: c.window.expiresAt > now, windowHours: c.window.windowHours, policy: c.window.policyVersionId } : null,
    entryPoints: c.entryPoints.map((e) => ({
      id: e.id,
      type: e.type,
      source: e.source,
      userMessageAt: e.userMessageAt,
      firstBusinessReplyAt: e.firstBusinessReplyAt,
      freeWindowStartedAt: e.freeWindowStartedAt,
      freeWindowExpiresAt: e.freeWindowExpiresAt,
      open: !!e.freeWindowExpiresAt && e.freeWindowExpiresAt > now && e.verificationStatus !== "REJECTED",
      eligibility: e.eligibility,
      verificationStatus: e.verificationStatus,
    })),
  }));
}

export async function getConversation(ctx: AppContext, tenantId: string, id: string) {
  const c = await ctx.db.conversation.findFirst({ where: { id, tenantId }, include: { customer: { select: { phoneMasked: true } }, window: true, entryPoints: true, events: { orderBy: { occurredAt: "desc" }, take: 100 } } });
  if (!c) throw Errors.notFound("Conversation");
  return c;
}
