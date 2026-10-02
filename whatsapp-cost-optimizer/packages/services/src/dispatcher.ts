import {
  AlertSeverity,
  AlertType,
  BillingCategory,
  MessageKind,
  MessageStatus,
  PricingStatus,
} from "@wco/domain";
import { metrics, withSpan } from "@wco/logging";
import { priceAt, sanitizeParam } from "@wco/optimization";
import { CircuitOpenError, isProviderError, type SendResult, type TemplateParameter } from "@wco/whatsapp";
import { audit, event, raiseAlert } from "./audit";
import type { AppContext } from "./context";
import { loadConversationContext, markBusinessReply } from "./conversations";
import { incrementQuota, incrementTier, loadCounters } from "./counters";
import { costRows } from "./optimizer";
import { toIntentRecord } from "./records";

/** Thrown when the job must be re-queued later without counting as a failure (pair rate limit, circuit open). */
export class RetryLaterError extends Error {
  constructor(
    readonly delayMs: number,
    reason: string,
  ) {
    super(reason);
    this.name = "RetryLaterError";
  }
}

/** Spec §55: one message every 6 seconds per (business number, user) — respected, never circumvented. */
const PAIR_SPACING_MS = 6_000;

export async function dispatchAttempt(ctx: AppContext, job: { tenantId: string; attemptId: string }, opts: { finalAttempt: boolean }): Promise<{ status: string }> {
  const attempt = await ctx.db.messageAttempt.findFirst({ where: { id: job.attemptId, tenantId: job.tenantId } });
  if (!attempt) return { status: "missing" };
  if (attempt.status !== MessageStatus.QUEUED && attempt.status !== MessageStatus.SENDING) return { status: `skipped:${attempt.status}` };
  const intent = await ctx.db.messageIntent.findFirstOrThrow({ where: { id: attempt.intentId, tenantId: job.tenantId } });
  const tenant = await ctx.tenants.get(job.tenantId);
  const customer = await ctx.db.customer.findFirstOrThrow({ where: { id: intent.customerId, tenantId: job.tenantId } });
  const phone = tenant.phones.find((p) => p.id === intent.phoneNumberId);
  const waba = phone ? (tenant.wabas.get(phone.wabaId) ?? null) : null;
  if (!phone) throw new Error(`Phone number ${intent.phoneNumberId} not found for tenant`);

  // Consent may have changed while the intent was buffered.
  const isMarketing = attempt.category === BillingCategory.MARKETING || attempt.category === BillingCategory.MARKETING_LITE;
  if (customer.optedOutAt || customer.erasedAt || (isMarketing && customer.marketingOptedOutAt)) {
    await ctx.db.$transaction([
      ctx.db.messageAttempt.update({ where: { id: attempt.id }, data: { status: MessageStatus.CANCELLED, errorCode: "OPTED_OUT" } }),
      ctx.db.messageIntent.updateMany({ where: { tenantId: job.tenantId, id: { in: attempt.coveredIntentIds } }, data: { status: MessageStatus.BLOCKED, decisionReason: "opted_out_before_dispatch" } }),
    ]);
    return { status: "blocked:opt_out" };
  }

  const recipient = ctx.vault.decryptPhone(customer.phoneEncrypted);
  if (!recipient) throw new Error("Customer phone unavailable");
  const pairKey = `wco:pair:${phone.metaPhoneNumberId}:${customer.phoneHash}`;
  const ok = await ctx.redis.set(pairKey, "1", "PX", PAIR_SPACING_MS, "NX");
  if (!ok) {
    const ttl = await ctx.redis.pttl(pairKey);
    throw new RetryLaterError(Math.max(250, ttl), "pair rate limit spacing");
  }

  return withSpan("message.dispatch", async () => {
    const now = ctx.now();
    const engine = await ctx.pricing.engine();
    const timezone = waba?.timezone ?? tenant.defaultTimezone;
    const currency = waba?.currency ?? tenant.defaultCurrency;
    const { context, conversationId } = await loadConversationContext(ctx.db, tenant.id, intent.phoneNumberId, intent.customerId);
    const counters = await loadCounters(ctx.db, { tenantId: tenant.id, phoneNumberId: intent.phoneNumberId, businessAccountId: waba?.businessAccountId ?? "-", market: intent.market, timezone, at: now });
    const rec = toIntentRecord(intent, recipient);
    const kind = attempt.messageKind as MessageKind;
    const category = (attempt.category ?? intent.category ?? "UTILITY") as BillingCategory;
    const estimate = priceAt(rec, now, kind, category, context, { engine, counters, timezone, currency, quotaUsed: 0, tierPosition: 0, authInternationalEligible: waba?.authInternationalEligible ?? false }, true);
    if (estimate.pricingStatus === PricingStatus.NOT_ELIGIBLE) {
      // e.g. a free-form message whose customer service window closed while buffered: never send it.
      await ctx.db.$transaction([
        ctx.db.messageAttempt.update({ where: { id: attempt.id }, data: { status: MessageStatus.CANCELLED, errorCode: "WINDOW_CLOSED", pricingStatus: estimate.pricingStatus } }),
        ctx.db.messageIntent.updateMany({ where: { tenantId: tenant.id, id: { in: attempt.coveredIntentIds } }, data: { status: MessageStatus.CANCELLED, decisionReason: "customer_service_window_closed_before_dispatch" } }),
      ]);
      await audit(ctx.db, { tenantId: tenant.id, action: "message.cancelled", entityType: "MessageAttempt", entityId: attempt.id, data: { reason: "window_closed" } });
      return { status: "cancelled:window_closed" };
    }

    await ctx.db.messageAttempt.update({ where: { id: attempt.id }, data: { status: MessageStatus.SENDING } });
    await ctx.db.messageIntent.update({ where: { id: intent.id, tenantId: tenant.id }, data: { status: MessageStatus.SENDING } });

    const payload = (attempt.payload ?? {}) as { parameters?: TemplateParameter[]; text?: string | null };
    const template = attempt.templateName ? tenant.templates.get(attempt.templateName) : undefined;
    const data = rec.data;
    const params: TemplateParameter[] =
      payload.parameters && payload.parameters.length > 0
        ? payload.parameters
        : (template?.bodyParams ?? []).map((name) => ({ name, value: sanitizeParam(data[name]) }));
    const hint = {
      billable: estimate.pricingStatus === PricingStatus.PAID,
      type: (estimate.freeReason === "free_entry_point_window" ? "free_entry_point" : estimate.isFree && estimate.freeReason === "customer_service_window" ? "free_customer_service" : "regular") as "regular" | "free_customer_service" | "free_entry_point",
      category: category.toLowerCase().replace("authentication_international", "authentication-international"),
    };
    const provider = ctx.provider(waba);
    const creds = { accessToken: waba?.accessTokenEncrypted ? ctx.vault.decryptSecret(waba.accessTokenEncrypted) : (ctx.config.meta.devCredentials.accessToken ?? "mock-token") };
    const base = { phoneNumberId: phone.metaPhoneNumberId, to: recipient, bizOpaqueCallbackData: attempt.id, mockPricingHint: hint };
    let res: SendResult;
    try {
      res =
        kind === MessageKind.NON_TEMPLATE
          ? await provider.sendMessage({ ...base, text: payload.text ?? intent.freeFormText ?? "" }, creds)
          : await provider.sendTemplate({ ...base, template: { name: attempt.templateName!, language: intent.templateLanguage ?? template?.language ?? "pt_BR", bodyParameters: params, parameterFormat: template?.parameterFormat } }, creds);
    } catch (e) {
      if (e instanceof CircuitOpenError) {
        await ctx.db.messageAttempt.update({ where: { id: attempt.id }, data: { status: MessageStatus.QUEUED, errorCode: "CIRCUIT_OPEN" } });
        throw new RetryLaterError(e.retryAfterMs, "circuit open");
      }
      const retryable = isProviderError(e) ? e.retryable : true;
      const code = isProviderError(e) ? String(e.providerCode ?? e.code) : "UNKNOWN";
      if (retryable && !opts.finalAttempt) {
        await ctx.db.messageAttempt.update({ where: { id: attempt.id }, data: { status: MessageStatus.QUEUED, errorCode: code, errorMessage: (e as Error).message.slice(0, 500), retryable: true } });
        throw e;
      }
      await failAttempt(ctx, tenant.id, attempt.id, attempt.coveredIntentIds, code, (e as Error).message, retryable);
      if (isProviderError(e)) await handleProviderAction(ctx, tenant.id, intent.customerId, e.action, code);
      throw e;
    }

    const sentAt = res.acceptedAt;
    await ctx.db.$transaction(async (tx) => {
      await tx.messageAttempt.update({
        where: { id: attempt.id },
        data: {
          status: MessageStatus.SENT,
          providerMessageId: res.providerMessageId,
          sentAt,
          latencyMs: res.latencyMs,
          estimatedCost: estimate.estimatedCost.toFixed(8),
          pricingStatus: estimate.pricingStatus,
          freeReason: estimate.freeReason,
          errorCode: null,
          errorMessage: null,
        },
      });
      await tx.messageIntent.update({ where: { id: intent.id, tenantId: tenant.id }, data: { status: MessageStatus.SENT, sentAt, estimatedCost: estimate.estimatedCost.toFixed(8) } });
      await tx.costDecision.createMany({ data: costRows(tenant.id, intent.id, [estimate], now) as never });
      await event(tx, { tenantId: tenant.id, type: "DISPATCH", intentId: intent.id, conversationId, occurredAt: sentAt, data: { attemptId: attempt.id, wamid: res.providerMessageId, latencyMs: res.latencyMs, pricing: { status: estimate.pricingStatus, freeReason: estimate.freeReason, policy: estimate.policyVersion } } });
      if (estimate.pricingStatus === PricingStatus.QUOTA && estimate.eligibility.quota && waba) {
        await incrementQuota(tx, { tenantId: tenant.id, phoneNumberId: intent.phoneNumberId, wabaId: waba.id, businessAccountId: waba.businessAccountId, category, at: now, timezone, quota: estimate.eligibility.quota.amount, policyVersion: estimate.policyVersion ?? "", confirmed: false });
      }
      if (estimate.eligibility.countsTowardTier && waba) {
        await incrementTier(tx, { tenantId: tenant.id, businessAccountId: waba.businessAccountId, market: estimate.market, category: estimate.category, at: now, timezone, confirmed: false });
      }
      if (conversationId && estimate.eligibility.windows.freeEntryPoint.opensOnThisMessage) {
        const policy = engine.policies.forInstant(now, timezone);
        await markBusinessReply(tx, tenant.id, conversationId, sentAt, policy?.definition.freeEntryPoint.windowHours ?? 72, policy?.definition.freeEntryPoint.replyWithinHours ?? 24);
      }
    });
    metrics.messagesSent.inc({ tenant_id: tenant.id, category });
    if (estimate.eligibility.freeReason === "free_entry_point_window") metrics.freeEntryPointUsage.inc({ tenant_id: tenant.id });
    if (estimate.pricingStatus === PricingStatus.QUOTA) metrics.freeQuotaUsage.inc({ tenant_id: tenant.id });
    return { status: "sent" };
  });
}

export async function failAttempt(ctx: AppContext, tenantId: string, attemptId: string, covered: string[], code: string, message: string, retryable: boolean): Promise<void> {
  await ctx.db.$transaction([
    ctx.db.messageAttempt.update({ where: { id: attemptId }, data: { status: MessageStatus.FAILED, errorCode: code, errorMessage: message.slice(0, 500), retryable } }),
    ctx.db.messageIntent.updateMany({ where: { tenantId, id: { in: covered }, status: { in: [MessageStatus.QUEUED, MessageStatus.SENDING] } }, data: { status: MessageStatus.FAILED, failedAt: ctx.now() } }),
  ]);
  await audit(ctx.db, { tenantId, action: "message.failed", entityType: "MessageAttempt", entityId: attemptId, data: { code, retryable } });
}

async function handleProviderAction(ctx: AppContext, tenantId: string, customerId: string, action: string, code: string): Promise<void> {
  const now = ctx.now();
  switch (action) {
    case "MARKETING_OPT_OUT":
      await ctx.db.consentRecord.create({ data: { tenantId, customerId, type: "OPT_OUT", scope: "MARKETING", source: "WEBHOOK_ERROR_131050", occurredAt: now } });
      await ctx.db.customer.update({ where: { id: customerId }, data: { marketingOptedOutAt: now } });
      break;
    case "PAYMENT_ISSUE":
      await raiseAlert(ctx.db, { tenantId, type: AlertType.PAYMENT_METHOD_ISSUE, severity: AlertSeverity.CRITICAL, title: "Problema no método de pagamento da WABA", message: `A Meta recusou envios (código ${code}). Verifique o Billing Hub.`, dedupKey: `payment:${tenantId}:${now.toISOString().slice(0, 10)}` });
      break;
    case "AUTH_ISSUE":
    case "ACCOUNT_RESTRICTED":
      await raiseAlert(ctx.db, { tenantId, type: AlertType.ACCOUNT_RESTRICTION, severity: AlertSeverity.CRITICAL, title: "Acesso/conta restrita na Meta", message: `A Meta retornou ${code}. Verifique token, permissões e status da WABA.`, dedupKey: `account:${tenantId}:${code}:${now.toISOString().slice(0, 10)}` });
      break;
    default:
      break;
  }
}
