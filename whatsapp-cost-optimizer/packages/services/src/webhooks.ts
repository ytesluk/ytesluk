import {
  AlertSeverity,
  AlertType,
  BillingCategory,
  Confidence,
  MessageStatus,
  Money,
  billingMonth,
  fromWaId,
  localDate,
  mergeDeliveryStatus,
  money,
  sha256Hex,
  type Decimal,
} from "@wco/domain";
import { metrics } from "@wco/logging";
import { normalizeMarket } from "@wco/pricing";
import {
  billingCategoryFromWebhook,
  classifyMetaError,
  isOptOutKeyword,
  parseWebhook,
  verifySignature,
  webhookFields,
  type AccountUpdateEvent,
  type InboundMessageEvent,
  type StatusEvent,
  type TemplateCategoryEvent,
  type TemplateStatusEvent,
  type UserPreferenceEvent,
} from "@wco/whatsapp";
import { audit, event, raiseAlert } from "./audit";
import type { AppContext, TenantConfig } from "./context";
import { recordInbound } from "./conversations";
import { incrementQuota, incrementTier } from "./counters";
import { QUEUE } from "./queues";
import { recordSavings } from "./savings-store";

/**
 * Webhook pipeline (spec §25):  Validate → Persist raw event → ACK 200 → Queue → Processor.
 * Never processed synchronously. Identical redeliveries (same raw body) are stored once (spec §41 case 10).
 */
export async function ingestWebhook(
  ctx: AppContext,
  input: { rawBody: Buffer; signature: string | undefined },
): Promise<{ status: 200 | 401 | 400; duplicate?: boolean; id?: string }> {
  const appSecret = ctx.config.meta.appSecret;
  if (!verifySignature(input.rawBody, input.signature, appSecret)) {
    metrics.webhooksReceived.inc({ outcome: "invalid_signature" });
    return { status: 401 };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(input.rawBody.toString("utf8"));
  } catch {
    metrics.webhooksReceived.inc({ outcome: "invalid_json" });
    return { status: 400 };
  }
  const payloadHash = sha256Hex(input.rawBody);
  try {
    const row = await ctx.db.webhookEvent.create({
      data: {
        provider: ctx.config.meta.mock ? "MOCK" : "META_CLOUD_API",
        field: webhookFields(payload).join(",") || null,
        payloadHash,
        signatureValid: true,
        rawPayload: payload as never,
      },
    });
    await ctx.queues[QUEUE.WEBHOOK].add("process", { webhookEventId: row.id }, { jobId: `wh-${row.id}` });
    metrics.webhooksReceived.inc({ outcome: "accepted" });
    return { status: 200, id: row.id };
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") {
      metrics.webhooksReceived.inc({ outcome: "duplicate" });
      return { status: 200, duplicate: true };
    }
    throw e;
  }
}

export class WebhookRetryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookRetryError";
  }
}

export async function processWebhook(ctx: AppContext, job: { webhookEventId: string }, opts: { finalAttempt: boolean }): Promise<{ events: number }> {
  const row = await ctx.db.webhookEvent.findUnique({ where: { id: job.webhookEventId } });
  if (!row || row.status === "PROCESSED" || row.status === "IGNORED") return { events: 0 };
  if (!row.rawPayload) return { events: 0 };
  await ctx.db.webhookEvent.update({ where: { id: row.id }, data: { status: "PROCESSING", attempts: { increment: 1 } } });
  const events = parseWebhook(row.rawPayload);
  let tenantId: string | null = row.tenantId;
  try {
    for (const ev of events) {
      const t = await resolveTenant(ctx, ev);
      if (!t) continue;
      tenantId = t.tenantId;
      const tenant = await ctx.tenants.get(t.tenantId);
      switch (ev.type) {
        case "status":
          await handleStatus(ctx, tenant, ev, row.id, opts);
          break;
        case "inbound":
          await handleInbound(ctx, tenant, t.phoneId, ev);
          break;
        case "template_status":
          await handleTemplateStatus(ctx, tenant, ev);
          break;
        case "template_category":
          await handleTemplateCategory(ctx, tenant, ev);
          break;
        case "account_update":
          await handleAccountUpdate(ctx, tenant, ev);
          break;
        case "user_preference":
          await handleUserPreference(ctx, tenant, ev);
          break;
        default:
          break;
      }
    }
    await ctx.db.webhookEvent.update({ where: { id: row.id }, data: { status: events.length ? "PROCESSED" : "IGNORED", processedAt: ctx.now(), tenantId, error: null } });
    return { events: events.length };
  } catch (e) {
    await ctx.db.webhookEvent.update({ where: { id: row.id }, data: { status: opts.finalAttempt ? "DEAD" : "FAILED", error: (e as Error).message.slice(0, 1000), tenantId } });
    if (opts.finalAttempt) {
      await raiseAlert(ctx.db, {
        tenantId,
        type: AlertType.WEBHOOK_FAILURE,
        severity: AlertSeverity.CRITICAL,
        title: "Falha ao processar webhook",
        message: `O evento ${row.id} esgotou as tentativas: ${(e as Error).message.slice(0, 200)}`,
        dedupKey: `webhook-dead:${row.id}`,
      });
    }
    throw e;
  }
}

async function resolveTenant(ctx: AppContext, ev: { wabaId: string } & Partial<{ phoneNumberId: string }>): Promise<{ tenantId: string; phoneId: string | null } | null> {
  if (ev.phoneNumberId) {
    const p = await ctx.db.phoneNumber.findUnique({ where: { metaPhoneNumberId: ev.phoneNumberId } });
    if (p) return { tenantId: p.tenantId, phoneId: p.id };
  }
  const w = await ctx.db.waba.findUnique({ where: { metaWabaId: ev.wabaId } });
  return w ? { tenantId: w.tenantId, phoneId: null } : null;
}

const STATUS_MAP: Record<string, MessageStatus> = {
  sent: MessageStatus.SENT,
  delivered: MessageStatus.DELIVERED,
  read: MessageStatus.READ,
  played: MessageStatus.READ,
  failed: MessageStatus.FAILED,
};

async function handleStatus(ctx: AppContext, tenant: TenantConfig, ev: StatusEvent, webhookEventId: string, opts: { finalAttempt: boolean }): Promise<void> {
  const status = STATUS_MAP[ev.status];
  if (!status) return;
  let attempt = await ctx.db.messageAttempt.findUnique({ where: { providerMessageId: ev.messageId } });
  if (!attempt && ev.bizOpaqueCallbackData) attempt = await ctx.db.messageAttempt.findFirst({ where: { id: ev.bizOpaqueCallbackData, tenantId: tenant.id } });
  if (!attempt || attempt.tenantId !== tenant.id) {
    // The send response may not be persisted yet (race with fast webhooks): retry, then give up.
    if (!opts.finalAttempt) throw new WebhookRetryError(`Unknown message ${ev.messageId.slice(0, 24)}… (not yet persisted)`);
    return;
  }
  try {
    await ctx.db.messageDelivery.create({
      data: {
        tenantId: tenant.id,
        attemptId: attempt.id,
        providerMessageId: ev.messageId,
        status,
        occurredAt: ev.timestamp,
        pricingBillable: ev.pricing?.billable ?? null,
        pricingType: ev.pricing?.type ?? null,
        pricingCategory: ev.pricing?.category ?? null,
        pricingModel: ev.pricing?.pricingModel ?? null,
        metaConversationId: ev.conversation?.id ?? null,
        conversationExpiresAt: ev.conversation?.expiresAt ?? null,
        errorCode: ev.errors?.[0] ? String(ev.errors[0].code) : null,
        errorTitle: ev.errors?.[0]?.title ?? null,
        webhookEventId,
      },
    });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return; // same status already processed (idempotent)
    throw e;
  }
  const merged = mergeDeliveryStatus(attempt.status as MessageStatus, status);
  const intent = await ctx.db.messageIntent.findFirstOrThrow({ where: { id: attempt.intentId, tenantId: tenant.id } });
  const intentData: Record<string, unknown> = { status: mergeDeliveryStatus(intent.status as MessageStatus, status) };
  if (status === MessageStatus.DELIVERED || (status === MessageStatus.READ && !intent.deliveredAt)) intentData.deliveredAt = ev.timestamp;
  if (status === MessageStatus.READ) intentData.readAt = ev.timestamp;
  if (status === MessageStatus.FAILED && merged === MessageStatus.FAILED) intentData.failedAt = ev.timestamp;
  await ctx.db.messageAttempt.update({ where: { id: attempt.id }, data: { status: merged } });
  await ctx.db.messageIntent.update({ where: { id: intent.id, tenantId: tenant.id }, data: intentData });
  await event(ctx.db, { tenantId: tenant.id, type: "STATUS", intentId: intent.id, occurredAt: ev.timestamp, data: { status: ev.status, pricing: ev.pricing ?? null, conversation: ev.conversation ? { id: ev.conversation.id, expiresAt: ev.conversation.expiresAt } : null, errors: ev.errors } });

  if (status === MessageStatus.FAILED && ev.errors?.[0]) {
    const cls = classifyMetaError(ev.errors[0].code);
    if (cls.action === "MARKETING_OPT_OUT") {
      const now = ctx.now();
      await ctx.db.consentRecord.create({ data: { tenantId: tenant.id, customerId: intent.customerId, type: "OPT_OUT", scope: "MARKETING", source: "WEBHOOK_ERROR_131050", occurredAt: now } });
      await ctx.db.customer.update({ where: { id: intent.customerId }, data: { marketingOptedOutAt: now } });
    }
  }
  // FEP confirmation as soon as Meta reports the window (sent status carries conversation.expiration_timestamp).
  if (ev.conversation?.expiresAt && (ev.conversation.originType === "referral_conversion" || ev.pricing?.type === "free_entry_point")) {
    await confirmFep(ctx, tenant.id, intent.phoneNumberId, intent.customerId, ev.conversation.id ?? null, ev.conversation.expiresAt);
  }
  if (merged === MessageStatus.DELIVERED || merged === MessageStatus.READ) await realize(ctx, tenant, attempt.id);
}

async function confirmFep(ctx: AppContext, tenantId: string, phoneNumberId: string, customerId: string, metaConversationId: string | null, expiresAt: Date): Promise<void> {
  const conv = await ctx.db.conversation.findFirst({ where: { tenantId, phoneNumberId, customerId } });
  if (!conv) return;
  const ep = await ctx.db.conversationEntryPoint.findFirst({ where: { tenantId, conversationId: conv.id }, orderBy: { userMessageAt: "desc" } });
  if (ep) {
    await ctx.db.conversationEntryPoint.update({ where: { id: ep.id }, data: { verificationStatus: "CONFIRMED", freeWindowExpiresAt: expiresAt, metaConversationId, eligibility: "OPEN" } });
  } else {
    // Meta confirmed a FEP window we could not detect (e.g. Facebook Page CTA without referral).
    const startedAt = new Date(expiresAt.getTime() - 72 * 3_600_000);
    await ctx.db.conversationEntryPoint.create({
      data: { tenantId, conversationId: conv.id, type: "OTHER", source: "meta:confirmed", occurredAt: startedAt, userMessageAt: startedAt, firstBusinessReplyAt: startedAt, freeWindowStartedAt: startedAt, freeWindowExpiresAt: expiresAt, eligibility: "OPEN", verificationStatus: "CONFIRMED", metaConversationId },
    });
  }
}

/**
 * Realized cost (spec §14): Meta's `pricing` object decides FREE vs BILLABLE and the rate category;
 * WCO's rate card provides the price for that category/market/tier. Without a pricing object the cost
 * stays an ESTIMATE (never "saved" without evidence, spec §106).
 */
async function realize(ctx: AppContext, tenant: TenantConfig, attemptId: string): Promise<void> {
  const attempt = await ctx.db.messageAttempt.findUnique({ where: { id: attemptId }, include: { deliveries: true } });
  if (!attempt || attempt.realizedAt) return;
  const priced = attempt.deliveries.find((d) => d.pricingType || d.pricingBillable !== null);
  const deliveredRow = attempt.deliveries.find((d) => d.status === MessageStatus.DELIVERED) ?? attempt.deliveries.find((d) => d.status === MessageStatus.READ);
  if (!deliveredRow) return;
  const intent = await ctx.db.messageIntent.findFirstOrThrow({ where: { id: attempt.intentId, tenantId: tenant.id } });
  const phone = tenant.phones.find((p) => p.id === intent.phoneNumberId);
  const waba = phone ? tenant.wabas.get(phone.wabaId) : undefined;
  const timezone = waba?.timezone ?? tenant.defaultTimezone;
  const currency = waba?.currency ?? tenant.defaultCurrency;
  const at = deliveredRow.occurredAt;
  const market = intent.market ?? "OTHER";
  let cost: Decimal = new Money(0);
  let confidence: Confidence = Confidence.ESTIMATED;
  let freeReason: string | null = null;
  let category = (attempt.category ?? intent.category ?? "UTILITY") as BillingCategory;
  let tierLabel: string | null = null;
  const engine = await ctx.pricing.engine();
  const policy = engine.policies.forInstant(at, timezone);

  if (priced) {
    confidence = Confidence.REALIZED;
    const billable = priced.pricingType ? priced.pricingType === "regular" : priced.pricingBillable === true;
    category = (billingCategoryFromWebhook(priced.pricingCategory ?? undefined) as BillingCategory | null) ?? category;
    if (!billable) {
      freeReason = priced.pricingType === "free_entry_point" ? "free_entry_point_window" : priced.pricingType === "free_customer_service" ? "customer_service_window" : "not_billable";
      // Service messages free under the monthly tier count against the quota.
      const rule = policy?.ruleFor(category, market);
      if (category === BillingCategory.SERVICE && rule?.freeQuota && freeReason !== "free_entry_point_window" && waba) {
        freeReason = "free_monthly_quota";
        await incrementQuota(ctx.db, { tenantId: tenant.id, phoneNumberId: intent.phoneNumberId, wabaId: waba.id, businessAccountId: waba.businessAccountId, category, at, timezone, quota: rule.freeQuota.amount, policyVersion: policy!.id, confirmed: true });
      }
    } else {
      const card = engine.rates.select(currency, localDate(at, timezone));
      const rule = policy?.ruleFor(category, market);
      const calc = card?.calculator(market, rule?.rateCategory ?? category, localDate(at, timezone)) ?? (rule?.rateCategoryFallback ? card?.calculator(market, rule.rateCategoryFallback, localDate(at, timezone)) : null);
      if (calc && card) {
        let position = 1;
        if (rule?.tiered && waba) {
          const acc = await ctx.db.tierAccrual.findUnique({
            where: { tenantId_businessAccountId_market_category_periodKey: { tenantId: tenant.id, businessAccountId: waba.businessAccountId, market, category, periodKey: billingMonth(at, timezone) } },
          });
          position = (acc?.chargedConfirmed ?? 0) + 1;
          await incrementTier(ctx.db, { tenantId: tenant.id, businessAccountId: waba.businessAccountId, market, category, at, timezone, confirmed: true });
          tierLabel = card.tierInfo(calc.calc, position).label;
          metrics.tierDistribution.inc({ market, category, tier: tierLabel });
        }
        cost = calc.calc.rateAt(position);
      } else {
        confidence = Confidence.UNKNOWN;
        metrics.costCalculationErrors.inc({ reason: "no_rate_for_realized_cost" });
      }
    }
    // Verify the locally estimated FEP window against Meta's decision.
    if (attempt.freeReason === "free_entry_point_window" && billable) {
      const conv = await ctx.db.conversation.findFirst({ where: { tenantId: tenant.id, phoneNumberId: intent.phoneNumberId, customerId: intent.customerId } });
      if (conv) await ctx.db.conversationEntryPoint.updateMany({ where: { tenantId: tenant.id, conversationId: conv.id, verificationStatus: "ESTIMATED" }, data: { verificationStatus: "REJECTED", eligibility: "NOT_ELIGIBLE" } });
    }
  } else {
    cost = attempt.estimatedCost ? money(attempt.estimatedCost.toString()) : new Money(0);
    freeReason = attempt.freeReason;
  }

  const costStr = cost.toFixed(8);
  await ctx.db.messageAttempt.update({ where: { id: attempt.id }, data: { realizedCost: costStr, realizedAt: at } });
  await ctx.db.messageIntent.update({ where: { id: intent.id, tenantId: tenant.id }, data: { realizedCost: costStr, realizedConfidence: confidence } });
  await ctx.db.costDecision.create({
    data: {
      tenantId: tenant.id,
      messageIntentId: intent.id,
      kind: "REALIZED",
      category,
      market,
      currency,
      effectiveRate: costStr,
      isFree: cost.isZero(),
      freeReason,
      pricingStatus: cost.isZero() ? (freeReason === "free_monthly_quota" ? "QUOTA" : "FREE") : "PAID",
      tier: tierLabel,
      policyVersion: policy?.id ?? null,
      rateCardId: engine.rates.select(currency, localDate(at, timezone))?.id ?? null,
      estimatedCost: costStr,
      confidence,
      decisionReason: priced ? `meta_pricing:${priced.pricingType ?? (priced.pricingBillable ? "billable" : "free")}` : "no_pricing_object_estimate_kept",
      evidence: priced
        ? [`Meta pricing object: type=${priced.pricingType ?? "n/a"}, billable=${priced.pricingBillable ?? "n/a"}, category=${priced.pricingCategory ?? "n/a"}`, `Delivered at ${at.toISOString()}`]
        : ["No pricing object received yet; keeping WCO's estimate (ESTIMATED)"],
      evaluatedAt: ctx.now(),
    },
  });
  if (intent.baselineCost) {
    await recordSavings(ctx.db, ctx, tenant, {
      intentId: intent.id,
      status: MessageStatus.DELIVERED,
      day: at,
      currency,
      baselineCost: money(intent.baselineCost.toString()),
      optimizedCost: cost,
      optimizedConfidence: confidence,
      freeReason,
      switchedToFreeForm: (intent.decisionReason ?? "").includes("free_form_service_message_cheaper_inside_window"),
      category,
      eventType: intent.eventType,
      policyVersion: policy?.id ?? null,
    });
  }
  metrics.messagesDelivered.inc({ tenant_id: tenant.id, category });
  if (confidence === Confidence.REALIZED) metrics.realizedCost.inc({ tenant_id: tenant.id, currency }, cost.toNumber());
}

async function handleInbound(ctx: AppContext, tenant: TenantConfig, phoneId: string | null, ev: InboundMessageEvent): Promise<void> {
  const phone = tenant.phones.find((p) => p.id === phoneId) ?? tenant.phones.find((p) => p.metaPhoneNumberId === ev.phoneNumberId);
  if (!phone) return;
  const waba = tenant.wabas.get(phone.wabaId);
  const vp = ctx.vault.phone(fromWaId(ev.from));
  const customer = await ctx.db.customer.upsert({
    where: { tenantId_phoneHash: { tenantId: tenant.id, phoneHash: vp.hash } },
    create: { tenantId: tenant.id, phoneHash: vp.hash, phoneEncrypted: vp.encrypted, phoneMasked: vp.masked },
    update: {},
  });
  const engine = await ctx.pricing.engine();
  const policy = engine.policies.forInstant(ev.timestamp, waba?.timezone ?? tenant.defaultTimezone);
  const { conversationId, entryPointId } = await recordInbound(ctx.db, {
    tenantId: tenant.id,
    phoneNumberId: phone.id,
    customerId: customer.id,
    customerHash: vp.hash,
    at: ev.timestamp,
    sourceEventId: ev.messageId,
    windowHours: policy?.definition.customerServiceWindowHours ?? 24,
    policyVersionId: policy?.id ?? null,
    referral: ev.referral,
  });
  // Message contents are NOT stored (data minimization, spec §24).
  await event(ctx.db, { tenantId: tenant.id, type: "INBOUND_MESSAGE", conversationId, occurredAt: ev.timestamp, data: { messageType: ev.messageType, referral: ev.referral ? { sourceType: ev.referral.sourceType, sourceId: ev.referral.sourceId } : null, entryPointId } });
  if (isOptOutKeyword(ev.textForKeywordDetection)) {
    await ctx.db.consentRecord.create({ data: { tenantId: tenant.id, customerId: customer.id, type: "OPT_OUT", scope: "ALL", source: "INBOUND_KEYWORD", occurredAt: ev.timestamp } });
    await ctx.db.customer.update({ where: { id: customer.id }, data: { optedOutAt: ev.timestamp } });
    await audit(ctx.db, { tenantId: tenant.id, action: "consent.opt_out", entityType: "Customer", entityId: customer.id, data: { source: "keyword" } });
  }
}

async function findTemplate(ctx: AppContext, tenantId: string, ev: { templateId?: string; templateName?: string; language?: string }) {
  return ctx.db.template.findFirst({
    where: { tenantId, OR: [...(ev.templateId ? [{ externalId: ev.templateId }] : []), ...(ev.templateName ? [{ name: ev.templateName, ...(ev.language ? { language: ev.language } : {}) }] : [])] },
  });
}

async function handleTemplateStatus(ctx: AppContext, tenant: TenantConfig, ev: TemplateStatusEvent): Promise<void> {
  const t = await findTemplate(ctx, tenant.id, ev);
  if (!t) return;
  const map: Record<string, string> = { APPROVED: "APPROVED", REJECTED: "REJECTED", PAUSED: "PAUSED", DISABLED: "DISABLED", PENDING: "PENDING" };
  const status = map[ev.event];
  if (!status) return;
  const now = ctx.now();
  await ctx.db.template.update({
    where: { id: t.id },
    data: { status: status as never, ...(status === "APPROVED" ? { approvedAt: now } : {}), ...(status === "REJECTED" ? { rejectedAt: now } : {}) },
  });
  await audit(ctx.db, { tenantId: tenant.id, action: "template.status", entityType: "Template", entityId: t.id, data: { event: ev.event, reason: ev.reason } });
  await ctx.redis.publish("wco:tenant:changed", tenant.id);
}

async function handleTemplateCategory(ctx: AppContext, tenant: TenantConfig, ev: TemplateCategoryEvent): Promise<void> {
  const t = await findTemplate(ctx, tenant.id, ev);
  if (!t) return;
  const newCategory = ev.newCategory as never;
  await ctx.db.template.update({ where: { id: t.id }, data: { metaCategory: newCategory ?? t.metaCategory, previousCategory: (ev.previousCategory as never) ?? t.metaCategory, correctCategory: (ev.correctCategory as never) ?? null } });
  await raiseAlert(ctx.db, {
    tenantId: tenant.id,
    type: AlertType.TEMPLATE_CATEGORY_CHANGED,
    severity: AlertSeverity.WARNING,
    title: `Categoria do template ${t.name} alterada pela Meta`,
    message: `${ev.previousCategory ?? t.metaCategory ?? "?"} → ${ev.newCategory ?? ev.correctCategory ?? "?"}. A cobrança segue a categoria definida pela Meta.`,
    dedupKey: `tplcat:${t.id}:${ev.newCategory ?? ev.correctCategory}`,
  });
  await ctx.redis.publish("wco:tenant:changed", tenant.id);
}

async function handleAccountUpdate(ctx: AppContext, tenant: TenantConfig, ev: AccountUpdateEvent): Promise<void> {
  if (ev.event === "VOLUME_BASED_PRICING_TIER_UPDATE" && ev.volumeTier) {
    const waba = [...tenant.wabas.values()].find((w) => w.metaWabaId === ev.wabaId);
    const market = ev.volumeTier.region ? normalizeMarket(ev.volumeTier.region) : null;
    if (waba && market && ev.volumeTier.pricingCategory && ev.volumeTier.effectiveMonth) {
      await ctx.db.tierAccrual.upsert({
        where: { tenantId_businessAccountId_market_category_periodKey: { tenantId: tenant.id, businessAccountId: waba.businessAccountId, market, category: ev.volumeTier.pricingCategory as never, periodKey: ev.volumeTier.effectiveMonth } },
        create: { tenantId: tenant.id, businessAccountId: waba.businessAccountId, market, category: ev.volumeTier.pricingCategory as never, periodKey: ev.volumeTier.effectiveMonth, metaReportedTier: ev.volumeTier.tier ?? null },
        update: { metaReportedTier: ev.volumeTier.tier ?? null },
      });
    }
    await raiseAlert(ctx.db, {
      tenantId: tenant.id,
      type: AlertType.PRICE_CHANGED,
      severity: AlertSeverity.INFO,
      title: "Novo volume tier informado pela Meta",
      message: `${ev.volumeTier.pricingCategory} · ${ev.volumeTier.region} · tier ${ev.volumeTier.tier} (${ev.volumeTier.effectiveMonth})`,
      // Meta: duplicates of the same tier switch are possible; dedup keeps the first one.
      dedupKey: `tier:${tenant.id}:${ev.volumeTier.region}:${ev.volumeTier.pricingCategory}:${ev.volumeTier.tier}:${ev.volumeTier.effectiveMonth}`,
      data: ev.volumeTier,
    });
  } else if (ev.event === "ACCOUNT_RESTRICTION" || ev.violationType) {
    await raiseAlert(ctx.db, {
      tenantId: tenant.id,
      type: AlertType.ACCOUNT_RESTRICTION,
      severity: AlertSeverity.CRITICAL,
      title: "Restrição na conta WhatsApp Business",
      message: `${ev.violationType ?? ev.event}: ${(ev.restrictions ?? []).map((r) => r.type).join(", ") || "sem detalhes"}`,
      dedupKey: `restriction:${tenant.id}:${ev.violationType}:${(ev.restrictions ?? []).map((r) => `${r.type}-${r.expiration?.toISOString()}`).join("|")}`,
      data: ev,
    });
  }
}

async function handleUserPreference(ctx: AppContext, tenant: TenantConfig, ev: UserPreferenceEvent): Promise<void> {
  if (!ev.waId || ev.category !== "marketing_messages") return;
  const vp = ctx.vault.phone(fromWaId(ev.waId));
  const customer = await ctx.db.customer.findFirst({ where: { tenantId: tenant.id, phoneHash: vp.hash } });
  if (!customer) return;
  const at = ev.timestamp ?? ctx.now();
  const stop = ev.value === "stop";
  await ctx.db.consentRecord.create({ data: { tenantId: tenant.id, customerId: customer.id, type: stop ? "OPT_OUT" : "OPT_IN", scope: "MARKETING", source: "WEBHOOK_USER_PREFERENCES", occurredAt: at } });
  await ctx.db.customer.update({ where: { id: customer.id }, data: { marketingOptedOutAt: stop ? at : null } });
}
