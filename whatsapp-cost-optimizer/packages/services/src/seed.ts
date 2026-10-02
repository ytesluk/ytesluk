import { randomUUID } from "node:crypto";
import { hashPassword } from "@wco/config";
import { saveRateCardObject, upsertPolicyDefinition } from "@wco/database";
import {
  BillingCategory,
  Confidence,
  EntryPointType,
  MessageStatus,
  PricingStatus,
  addHours,
  customerHash,
  maskPhone,
  money,
  type Decimal,
} from "@wco/domain";
import { encrypt } from "@wco/config";
import {
  ALL_FEATURES,
  DEMO_TEMPLATES,
  DEMO_TEMPLATE_INFOS,
  InMemoryPipeline,
  attributeSavings,
  type IntentRecord,
} from "@wco/optimization";
import { DEFAULT_OPTIMIZATION_POLICIES, DEFAULT_RULESET, PolicyEngine } from "@wco/policy";
import { BUILTIN_POLICIES, CostEngine, PolicyRegistry, demoRateCards, type CostDecision } from "@wco/pricing";
import { DEFAULT_SCENARIO, generateDataset } from "@wco/simulator";
import { hashApiKey } from "./auth";
import type { AppContext } from "./context";

/**
 * Seed (spec §50): demo tenant(s), users, DEMO pricing policy + rate cards, templates, optimization
 * policies, and ~30 days of demo traffic produced by the REAL engines (in-memory pipeline) so the
 * dashboard has meaningful, internally consistent numbers. All demo money uses DEMO rates.
 */
export const DEMO_PASSWORD = "wco-demo-2026!";
export const DEMO_API_KEYS: Record<string, string> = { "loja-demo": "wco_demo_loja_dev_only_0000000000000000", acme: "wco_demo_acme_dev_only_0000000000000000" };

const PLANS = [
  { code: "FREE", name: "Free", monthlyFee: "0", includedIntents: 1_000 },
  { code: "STARTER", name: "Starter", monthlyFee: "199", includedIntents: 50_000 },
  { code: "PRO", name: "Pro", monthlyFee: "899", includedIntents: 500_000 },
  { code: "ENTERPRISE", name: "Enterprise", monthlyFee: "0", includedIntents: 100_000_000 },
] as const;

export async function seedPricing(ctx: AppContext): Promise<void> {
  for (const def of BUILTIN_POLICIES) await upsertPolicyDefinition(ctx.db, def);
  for (const card of demoRateCards()) await saveRateCardObject(ctx.db, card);
}

export async function seedTenant(ctx: AppContext, slug: string, name: string, opts: { usesBsp: boolean }) {
  const existing = await ctx.db.tenant.findUnique({ where: { slug } });
  if (existing) return { tenantId: existing.id, created: false };
  const tenant = await ctx.db.tenant.create({
    data: {
      slug,
      name,
      defaultCurrency: "BRL",
      defaultTimezone: "America/Sao_Paulo",
      requireOptIn: false,
      usesBsp: opts.usesBsp,
      bspFeeModel: opts.usesBsp ? { type: "PERCENTAGE", percentOfMeta: "10", label: "BSP hipotético (demo): 10% sobre cobranças da Meta" } : { type: "NONE" },
      plan: "PRO",
    },
  });
  const pw = hashPassword(DEMO_PASSWORD);
  await ctx.db.user.createMany({
    data: (["OWNER", "ADMIN", "ANALYST", "OPERATOR"] as const).map((role) => ({ tenantId: tenant.id, email: `${role.toLowerCase()}@${slug}.wco.dev`, name: `${role[0]}${role.slice(1).toLowerCase()} ${name}`, passwordHash: pw, role })),
  });
  if (!ctx.config.isProduction) {
    await ctx.db.apiKey.create({ data: { tenantId: tenant.id, name: "Dev key (seed)", prefix: DEMO_API_KEYS[slug]!.slice(0, 10), keyHash: hashApiKey(DEMO_API_KEYS[slug]!), role: "OPERATOR" } });
  }
  const ba = await ctx.db.businessAccount.create({ data: { tenantId: tenant.id, name, metaBusinessId: `mock-business-${slug}` } });
  const waba = await ctx.db.waba.create({ data: { tenantId: tenant.id, businessAccountId: ba.id, metaWabaId: `mock-waba-${slug}`, name: `${name} WABA`, timezone: "America/Sao_Paulo", currency: "BRL", provider: "MOCK", validatedAt: new Date(), webhookSubscribedAt: new Date() } });
  await ctx.db.phoneNumber.createMany({
    data: [
      { tenantId: tenant.id, wabaId: waba.id, metaPhoneNumberId: `mock-pn-${slug}-1`, displayPhoneNumber: "+55 11 4000-0001", verifiedName: name, qualityRating: "GREEN", isDefault: true },
      { tenantId: tenant.id, wabaId: waba.id, metaPhoneNumberId: `mock-pn-${slug}-2`, displayPhoneNumber: "+55 11 4000-0002", verifiedName: name, qualityRating: "GREEN", isDefault: false },
    ],
  });
  await ctx.db.template.createMany({
    data: DEMO_TEMPLATES.map((t) => ({
      tenantId: tenant.id,
      wabaId: waba.id,
      name: t.name,
      language: t.language,
      declaredCategory: t.category,
      metaCategory: t.category,
      status: "APPROVED" as const,
      components: [{ type: "BODY", text: t.body, params: t.bodyParams, parameterFormat: "NAMED" }],
      consolidationParam: t.consolidationParam ?? null,
      approvedAt: new Date(),
      externalId: `mock-template-${t.name}`,
    })),
  });
  await ctx.db.optimizationPolicy.createMany({
    data: DEFAULT_OPTIMIZATION_POLICIES.map((p) => ({ ...p, tenantId: tenant.id, supersessionGroup: p.supersessionGroup ?? null, consolidationTemplate: p.consolidationTemplate ?? null, defaultTemplate: p.defaultTemplate ?? null, defaultLanguage: p.defaultLanguage ?? "pt_BR", category: (p.category ?? null) as never })),
  });
  await ctx.db.policyRuleSet.create({ data: { tenantId: tenant.id, name: DEFAULT_RULESET.name, rules: DEFAULT_RULESET as never, active: true } });
  await ctx.db.dataRetentionPolicy.create({ data: { tenantId: tenant.id } });
  await ctx.db.subscription.create({ data: { tenantId: tenant.id, plan: "PRO" } });
  return { tenantId: tenant.id, created: true };
}

/** ~30 days of demo traffic produced by the real engines (DEMO rates). */
export async function seedDemoHistory(ctx: AppContext, tenantId: string, opts: { events?: number; customers?: number; days?: number } = {}): Promise<{ intents: number }> {
  const tenant = await ctx.db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  if ((await ctx.db.messageIntent.count({ where: { tenantId } })) > 0) return { intents: 0 };
  const phones = await ctx.db.phoneNumber.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } });
  const waba = await ctx.db.waba.findFirstOrThrow({ where: { tenantId } });
  const days = opts.days ?? 30;
  const now = ctx.now();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days, 3));
  const params = { ...DEFAULT_SCENARIO, name: "seed", seed: 4242, events: opts.events ?? 3_000, customers: opts.customers ?? 700, start: start.toISOString(), days, phoneNumbers: phones.length };
  const dataset = generateDataset(params).filter((e) => e.at < now.getTime());
  const engine = new CostEngine(new PolicyRegistry(BUILTIN_POLICIES), new (await import("@wco/pricing")).RateCatalog(demoRateCards()));

  const ids = new Map<string, string>();
  const uid = (simId: string) => {
    let id = ids.get(simId);
    if (!id) ids.set(simId, (id = randomUUID()));
    return id;
  };
  const phoneId = (sim: string) => phones[Number(sim.split("-")[1] ?? 0) % phones.length]!.id;
  const customers = new Map<string, { id: string; hash: string; recipient: string }>();
  const custFor = (key: string, recipient: string) => {
    let c = customers.get(key);
    if (!c) customers.set(key, (c = { id: randomUUID(), hash: customerHash(recipient, ctx.config.hashPepper), recipient }));
    return c;
  };
  const intents = new Map<string, { rec: IntentRecord; row: Record<string, unknown> }>();
  const decisions: Array<Record<string, unknown>> = [];
  const costs: Array<Record<string, unknown>> = [];
  const attempts: Array<Record<string, unknown>> = [];
  const deliveries: Array<Record<string, unknown>> = [];
  const savings: Array<Record<string, unknown>> = [];
  const attemptOf = new Map<string, string>();
  const costRow = (intentId: string, c: CostDecision, kind: string, at: Date) => ({
    id: randomUUID(),
    tenantId,
    messageIntentId: intentId,
    kind,
    category: c.category,
    market: c.market,
    currency: c.currency,
    baseRate: c.baseRate?.toFixed(8) ?? null,
    effectiveRate: c.effectiveRate.toFixed(8),
    isFree: c.isFree,
    freeReason: c.freeReason,
    pricingStatus: c.pricingStatus,
    tier: c.tier,
    policyVersion: c.policyVersion,
    rateCardId: c.rateCardId,
    estimatedCost: c.estimatedCost.toFixed(8),
    confidence: kind === "REALIZED" ? Confidence.REALIZED : c.confidence,
    decisionReason: c.decisionReason,
    evidence: c.evidence,
    evaluatedAt: at,
  });
  const known = (c: CostDecision | null | undefined): Decimal | null => (c && c.pricingStatus !== PricingStatus.UNKNOWN && c.pricingStatus !== PricingStatus.NOT_ELIGIBLE ? c.estimatedCost : null);
  const addSavings = (intentId: string, status: MessageStatus, baseline: Decimal | null, optimized: Decimal | null, confidence: Confidence, at: Date, freeReason?: string | null, category?: string, eventType?: string) => {
    for (const l of attributeSavings({ status, baselineCost: baseline, optimizedCost: optimized, optimizedConfidence: confidence, freeReason, usesBsp: tenant.usesBsp, bspModel: tenant.bspFeeModel as never, infraCostPerProviderCall: money(ctx.config.env.INFRA_COST_PER_PROVIDER_CALL) })) {
      savings.push({ id: randomUUID(), tenantId, intentId, day: new Date(`${at.toISOString().slice(0, 10)}T00:00:00.000Z`), kind: l.kind, mechanism: l.mechanism, baselineCost: l.baselineCost.toFixed(8), optimizedCost: l.optimizedCost.toFixed(8), savings: l.savings.toFixed(8), currency: l.kind === "INFRASTRUCTURE" ? ctx.config.env.INFRA_CURRENCY : "BRL", confidence: l.confidence, category: (category ?? null) as never, eventType: eventType ?? null, policyVersion: null });
    }
  };
  const baselineOf = new Map<string, CostDecision | null>();

  const p = new InMemoryPipeline({
    tenantId,
    timezone: waba.timezone,
    currency: waba.currency,
    engine,
    rules: new PolicyEngine(DEFAULT_RULESET),
    policies: DEFAULT_OPTIMIZATION_POLICIES,
    templates: DEMO_TEMPLATE_INFOS,
    features: ALL_FEATURES,
    deliveryRate: params.deliveryRate,
    explain: true,
    hooks: {
      onDecision(rec, d, at) {
        const id = uid(rec.id);
        baselineOf.set(rec.id, d.baselineCost);
        decisions.push({ id: randomUUID(), tenantId, intentId: id, action: d.action, reasons: d.reasons, explanation: { facts: d.facts, rule: d.rule, notes: d.explanation }, sendAt: d.sendAt, estimatedSavings: d.estimatedSavings.toFixed(8), currency: "BRL", opportunities: d.opportunities.map((o) => ({ ...o, potentialSaving: o.potentialSaving.toString() })), rulesetVersion: "default", createdAt: at });
        for (const [c, kind] of [[d.cost, "OPTIMIZED"], [d.baselineCost, "BASELINE"]] as const) if (c) costs.push(costRow(id, c, kind, at));
      },
      onAvoided(rec, status, baseline, at) {
        addSavings(uid(rec.id), status, known(baseline), null, Confidence.ESTIMATED, at, null, rec.category, rec.eventType);
      },
      onDispatch(primary, m, est, at, willDeliver) {
        const aid = randomUUID();
        attemptOf.set(primary.id, aid);
        attempts.push({ id: aid, tenantId, intentId: uid(primary.id), attemptNumber: 1, provider: "MOCK", providerMessageId: `wamid.SEED${aid.replace(/-/g, "")}`, status: willDeliver ? MessageStatus.DELIVERED : MessageStatus.FAILED, coveredIntentIds: m.coveredIntentIds.map(uid), messageKind: m.messageKind, templateName: m.templateName, category: m.category, payload: { parameters: m.parameters, consolidated: m.consolidated }, estimatedCost: est.estimatedCost.toFixed(8), pricingStatus: est.pricingStatus, freeReason: est.freeReason, latencyMs: 120 + Math.round(Math.random() * 200), requestedAt: at, sentAt: at, errorCode: willDeliver ? null : "131026" });
        deliveries.push({ id: randomUUID(), tenantId, attemptId: aid, providerMessageId: `wamid.SEED${aid.replace(/-/g, "")}`, status: "SENT", occurredAt: at });
        if (!willDeliver) deliveries.push({ id: randomUUID(), tenantId, attemptId: aid, providerMessageId: `wamid.SEED${aid.replace(/-/g, "")}`, status: "FAILED", occurredAt: new Date(at.getTime() + 3000), errorCode: "131026", errorTitle: "Message undeliverable" });
      },
      onDelivery(primary, realized, at) {
        const aid = attemptOf.get(primary.id)!;
        const type = realized.pricingStatus === PricingStatus.PAID ? "regular" : realized.freeReason === "free_entry_point_window" ? "free_entry_point" : "free_customer_service";
        deliveries.push({ id: randomUUID(), tenantId, attemptId: aid, providerMessageId: `wamid.SEED${aid.replace(/-/g, "")}`, status: "DELIVERED", occurredAt: at, pricingBillable: realized.pricingStatus === PricingStatus.PAID, pricingType: type, pricingCategory: realized.category.toLowerCase(), pricingModel: "PMP" });
        const a = attempts.find((x) => x.id === aid)!;
        a.realizedCost = realized.estimatedCost.toFixed(8);
        a.realizedAt = at;
        costs.push(costRow(uid(primary.id), realized, "REALIZED", at));
        const rec = intents.get(primary.id);
        if (rec) {
          rec.row.realizedCost = realized.estimatedCost.toFixed(8);
          rec.row.realizedConfidence = Confidence.REALIZED;
          rec.row.deliveredAt = at;
        }
        addSavings(uid(primary.id), MessageStatus.DELIVERED, known(baselineOf.get(primary.id)), realized.estimatedCost, Confidence.REALIZED, at, realized.freeReason, realized.category, primary.eventType);
      },
    },
  });

  const conversations = new Map<string, { id: string; customerId: string; phoneNumberId: string; lastInboundAt: Date }>();
  const entryPoints: Array<Record<string, unknown>> = [];
  const recipientOf = new Map<string, string>();
  for (const e of dataset) if (e.kind === "INTENT") recipientOf.set(e.sub.customerKey, e.sub.recipient);
  for (const e of dataset) {
    const at = new Date(e.at);
    const simKey = e.kind === "INBOUND" ? e.customerKey : e.sub.customerKey;
    const recipient = recipientOf.get(simKey);
    if (!recipient) continue;
    const c = custFor(simKey, recipient);
    if (e.kind === "INBOUND") {
      p.inbound(c.hash, e.phoneNumberId, at, e.entryPoint);
      const ck = `${e.phoneNumberId}:${c.hash}`;
      const conv = conversations.get(ck) ?? { id: randomUUID(), customerId: c.id, phoneNumberId: phoneId(e.phoneNumberId), lastInboundAt: at };
      conv.lastInboundAt = at;
      conversations.set(ck, conv);
      if (e.entryPoint === EntryPointType.CLICK_TO_WHATSAPP_AD) {
        entryPoints.push({ id: randomUUID(), tenantId, conversationId: conv.id, type: e.entryPoint, source: "ad:seed-campaign", occurredAt: at, userMessageAt: at, firstBusinessReplyAt: addHours(at, 0.1), freeWindowStartedAt: addHours(at, 0.1), freeWindowExpiresAt: addHours(at, 72.1), eligibility: "OPEN", verificationStatus: "CONFIRMED", sourcePayload: { sourceType: "ad", sourceId: "seed-campaign" } });
      }
      continue;
    }
    const rec = p.submit({ ...e.sub, customerKey: c.hash }, at);
    if (!intents.has(rec.id)) intents.set(rec.id, { rec, row: {} });
  }
  p.drain();

  // Persist (chunked createMany).
  const chunk = async <T>(rows: T[], fn: (batch: T[]) => Promise<unknown>) => {
    for (let i = 0; i < rows.length; i += 500) await fn(rows.slice(i, i + 500));
  };
  await chunk([...customers.values()], (b) =>
    ctx.db.customer.createMany({ data: b.map((c) => ({ id: c.id, tenantId, phoneHash: c.hash, phoneEncrypted: encrypt(c.recipient, ctx.config.encryptionKey), phoneMasked: maskPhone(c.recipient), optedInAt: start })) }),
  );
  const custByHash = new Map([...customers.values()].map((c) => [c.hash, c.id]));
  await chunk([...intents.values()], (b) =>
    ctx.db.messageIntent.createMany({
      data: b.map(({ rec, row }) => ({
        id: uid(rec.id),
        tenantId,
        customerId: custByHash.get(rec.customerKey)!,
        customerPhoneHash: rec.customerKey,
        phoneNumberId: phoneId(rec.phoneNumberId),
        businessEntityId: rec.businessEntityId,
        eventType: rec.eventType,
        payloadHash: rec.payloadHash,
        eventHash: rec.eventHash,
        idempotencyKey: `seed-${rec.id}`,
        occurredAt: rec.occurredAt,
        requestedAt: rec.requestedAt,
        status: rec.status,
        priority: rec.priority,
        maxDelaySeconds: rec.maxDelaySeconds,
        earliestSendAt: rec.earliestSendAt,
        preferredSendAt: rec.preferredSendAt,
        deadlineAt: rec.deadlineAt,
        mustSendImmediately: rec.mustSendImmediately,
        allowDeduplication: rec.allowDeduplication,
        allowAggregation: rec.allowAggregation,
        allowSupersession: rec.allowSupersession,
        messageKind: rec.messageKind,
        category: rec.category,
        templateName: rec.templateName ?? null,
        templateLanguage: "pt_BR",
        data: rec.data as never,
        groupKey: `${tenantId}:${phoneId(rec.phoneNumberId)}:${rec.customerKey}:${rec.businessEntityId ?? "-"}`,
        supersessionKey: rec.supersessionKey,
        consolidationKey: rec.consolidationKey,
        market: rec.market ?? null,
        currency: "BRL",
        baselineCost: known(baselineOf.get(rec.id))?.toFixed(8) ?? null,
        estimatedCost: (row.realizedCost as string | undefined) ?? null,
        realizedCost: (row.realizedCost as string | undefined) ?? null,
        realizedConfidence: (row.realizedConfidence as never) ?? null,
        sentAt: rec.sentAt ?? null,
        deliveredAt: (row.deliveredAt as Date | undefined) ?? null,
        decisionReason: "seed",
      })),
    }),
  );
  await chunk(decisions, (b) => ctx.db.optimizationDecision.createMany({ data: b as never }));
  await chunk(costs, (b) => ctx.db.costDecision.createMany({ data: b as never }));
  await chunk(attempts, (b) => ctx.db.messageAttempt.createMany({ data: b as never }));
  await chunk(deliveries, (b) => ctx.db.messageDelivery.createMany({ data: b as never, skipDuplicates: true }));
  await chunk(savings, (b) => ctx.db.savingsRecord.createMany({ data: b as never, skipDuplicates: true }));
  await chunk([...conversations.values()], (b) => ctx.db.conversation.createMany({ data: b.map((c) => ({ id: c.id, tenantId, customerId: c.customerId, phoneNumberId: c.phoneNumberId, lastInboundAt: c.lastInboundAt })) }));
  await chunk([...conversations.values()], (b) =>
    ctx.db.customerServiceWindow.createMany({ data: b.map((c) => ({ tenantId, conversationId: c.id, phoneNumberId: c.phoneNumberId, customerPhoneHash: [...customers.values()].find((x) => x.id === c.customerId)!.hash, lastInboundMessageAt: c.lastInboundAt, expiresAt: addHours(c.lastInboundAt, 24), status: addHours(c.lastInboundAt, 24) > now ? "OPEN" : "EXPIRED", windowHours: 24, policyVersionId: null })) }),
  );
  await chunk(entryPoints, (b) => ctx.db.conversationEntryPoint.createMany({ data: b as never }));
  // Fix attempt intent ids for consolidated covered lists (sim ids → uuids already mapped) and status of attempts.
  return { intents: intents.size };
}

export async function seedAll(ctx: AppContext, opts: { demoHistory?: boolean } = {}) {
  await ctx.db.plan.createMany({ data: PLANS.map((p) => ({ ...p, code: p.code as never })), skipDuplicates: true });
  await seedPricing(ctx);
  const demo = await seedTenant(ctx, "loja-demo", "Loja Demo", { usesBsp: true });
  const acme = await seedTenant(ctx, "acme", "ACME Indústria", { usesBsp: false });
  let history = { intents: 0 };
  if (opts.demoHistory !== false) history = await seedDemoHistory(ctx, demo.tenantId);
  return { demoTenantId: demo.tenantId, acmeTenantId: acme.tenantId, demoIntents: history.intents, password: DEMO_PASSWORD, apiKeys: ctx.config.isProduction ? {} : DEMO_API_KEYS, categories: Object.values(BillingCategory).length };
}
