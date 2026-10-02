import { BillingCategory, MessageKind, PricingStatus, addSeconds, billingMonth, maxDate, minDate } from "@wco/domain";
import type { CostDecision } from "@wco/pricing";
import type { ConversationContext } from "@wco/domain";
import type { OptimizationPolicyConfig } from "@wco/policy";
import type { IntentRecord, OptimizationFeatures, PricingInputs, ScheduleResult } from "./types";

/**
 * Smart scheduler (spec §62). Chooses WHEN (and, if allowed, AS WHAT KIND) to send so that cost is
 * minimal without ever exceeding the deadline:
 *
 *   input:  intent, deadline, priority, eligibility windows (CSW/FEP), aggregation window
 *   output: sendNow | sendAt | cancel
 *
 * Candidate instants: now/earliest, the debounce end, the preferred time, and "just before" each
 * free window closes (with a safety margin because Meta bills on DELIVERY time). Each candidate is
 * priced by the same CostEngine used for billing. The scheduler never waits for a hypothetical
 * future window (e.g. hoping the user writes) — only windows that are already open count.
 */
export interface ScheduleInput {
  intent: IntentRecord;
  policy: OptimizationPolicyConfig;
  now: Date;
  deadline: Date;
  conversation: ConversationContext;
  pricing: PricingInputs;
  features: OptimizationFeatures;
  bypassBuffer: boolean;
  safetyMarginSeconds: number;
  /** Ask for the cheapest kind/time but keep the buffering target (debounce end). */
  wantsBuffer: boolean;
  explain?: boolean;
}

interface Candidate {
  at: Date;
  kind: MessageKind;
  category: BillingCategory;
  cost: CostDecision;
  label: string;
}

function rank(c: CostDecision): number {
  if (c.pricingStatus === PricingStatus.NOT_ELIGIBLE) return Number.POSITIVE_INFINITY;
  if (c.pricingStatus === PricingStatus.UNKNOWN) return Number.MAX_SAFE_INTEGER;
  return c.estimatedCost.toNumber();
}

export function priceAt(
  intent: IntentRecord,
  at: Date,
  kind: MessageKind,
  category: BillingCategory,
  conversation: ConversationContext,
  pricing: PricingInputs,
  explain = true,
  costKind: CostDecision["kind"] = "OPTIMIZED",
): CostDecision {
  let quotaUsed = pricing.quotaUsed;
  let tierPosition = pricing.tierPosition;
  if (pricing.counters && intent.market) {
    const month = billingMonth(at, pricing.timezone);
    quotaUsed = pricing.counters.quotaUsed(intent.phoneNumberId, month);
    tierPosition = pricing.counters.tierPosition(intent.market, category, month);
  }
  return pricing.engine.decide({
    messageIntentId: intent.id,
    kind: costKind,
    category,
    messageKind: kind,
    at,
    timezone: pricing.timezone,
    currency: pricing.currency,
    recipient: intent.recipient,
    market: intent.market,
    businessPhoneNumberId: intent.phoneNumberId,
    conversation,
    quotaUsed,
    tierPosition,
    authInternationalEligible: pricing.authInternationalEligible,
    explain,
  });
}

export function schedule(input: ScheduleInput): ScheduleResult {
  const { intent, policy, now, deadline, conversation, pricing, features } = input;
  const earliest = maxDate(now, intent.earliestSendAt)!;
  const reasons: string[] = [];
  const explain = input.explain ?? true;

  // Bypass: critical/authentication/immediate → now, as the requested kind.
  if (input.bypassBuffer) {
    const cost = priceAt(intent, earliest, intent.messageKind, intent.category, conversation, pricing, explain);
    reasons.push("bypass_buffer");
    return { sendAt: earliest, mode: "SEND_NOW", reasons, messageKind: intent.messageKind, category: intent.category, cost, candidatesEvaluated: 1 };
  }

  const effectiveDeadline = deadline < earliest ? earliest : deadline;
  // Anchor = when a system without WCO would send (preferred time), never before `earliest`.
  const anchor = minDate(maxDate(intent.preferredSendAt, earliest), effectiveDeadline)!;
  const debounceEnd =
    features.debounce && policy.debounceSeconds > 0 ? minDate(addSeconds(anchor, policy.debounceSeconds), effectiveDeadline)! : anchor;
  const target = input.wantsBuffer ? debounceEnd : anchor;

  if (!features.pricingOptimizer) {
    // Pricing optimizer disabled (experiments A–D): no cost-based timing or channel choice.
    const cost = priceAt(intent, target, intent.messageKind, intent.category, conversation, pricing, explain);
    const mode = target.getTime() <= now.getTime() ? "SEND_NOW" : "SEND_AT";
    reasons.push(mode === "SEND_NOW" ? "send_now" : target === debounceEnd && target !== anchor ? "send_at_debounce_end" : "send_at_preferred_time");
    if (cost.pricingStatus === PricingStatus.NOT_ELIGIBLE) {
      return { sendAt: target, mode: "CANCEL", reasons: [...reasons, "not_sendable"], messageKind: intent.messageKind, category: intent.category, cost, candidatesEvaluated: 1 };
    }
    return { sendAt: target, mode, reasons, messageKind: intent.messageKind, category: intent.category, cost, candidatesEvaluated: 1 };
  }

  const instants: Array<{ at: Date; label: string }> = [
    { at: earliest, label: "earliest" },
    { at: anchor, label: "preferred" },
    { at: target, label: "debounce_end" },
  ];
  {
    // Probe windows open at `earliest`: send just before they close.
    const probe = priceAt(intent, earliest, intent.messageKind, intent.category, conversation, pricing, false);
    const w = probe.eligibility.windows;
    const margin = input.safetyMarginSeconds;
    for (const [expiresAt, label] of [
      [w.freeEntryPoint.expiresAt, "before_free_entry_point_window_closes"],
      [w.customerServiceWindow.open ? w.customerServiceWindow.expiresAt : null, "before_customer_service_window_closes"],
    ] as const) {
      if (!expiresAt) continue;
      const t = addSeconds(expiresAt, -margin);
      if (t > earliest && t <= effectiveDeadline) instants.push({ at: minDate(t, target)!, label });
    }
  }

  const kinds: Array<{ kind: MessageKind; category: BillingCategory }> = [{ kind: intent.messageKind, category: intent.category }];
  const freeFormAllowed =
    features.pricingOptimizer &&
    policy.allowFreeFormInWindow &&
    !!intent.freeFormText &&
    intent.messageKind === MessageKind.TEMPLATE &&
    intent.category === BillingCategory.UTILITY; // never for MARKETING/AUTHENTICATION (spec §98, §99)
  if (freeFormAllowed) kinds.push({ kind: MessageKind.NON_TEMPLATE, category: BillingCategory.SERVICE });

  const candidates: Candidate[] = [];
  for (const k of kinds) {
    for (const i of instants) {
      candidates.push({ at: i.at, kind: k.kind, category: k.category, label: i.label, cost: priceAt(intent, i.at, k.kind, k.category, conversation, pricing, false) });
    }
  }

  // Lowest cost; ties → closest to the buffering target; then prefer the requested kind.
  const best = candidates.reduce((a, b) => {
    const ra = rank(a.cost);
    const rb = rank(b.cost);
    if (ra !== rb) return ra < rb ? a : b;
    const da = Math.abs(a.at.getTime() - target.getTime());
    const db = Math.abs(b.at.getTime() - target.getTime());
    if (da !== db) return da < db ? a : b;
    if (a.kind !== b.kind) return a.kind === intent.messageKind ? a : b;
    return a;
  });

  if (rank(best.cost) === Number.POSITIVE_INFINITY) {
    reasons.push("not_sendable_before_deadline");
    return { sendAt: earliest, mode: "CANCEL", reasons, messageKind: best.kind, category: best.category, cost: best.cost, candidatesEvaluated: candidates.length };
  }
  // Re-price the winner with full evidence for the audit trail.
  const cost = explain ? priceAt(intent, best.at, best.kind, best.category, conversation, pricing, true) : best.cost;
  if (best.kind !== intent.messageKind) reasons.push("free_form_service_message_cheaper_inside_window");
  if (best.label.startsWith("before_")) reasons.push(best.label);
  const mode = best.at.getTime() <= now.getTime() ? "SEND_NOW" : "SEND_AT";
  reasons.push(mode === "SEND_NOW" ? "send_now" : `send_at_${best.label}`);
  return { sendAt: best.at, mode, reasons, messageKind: best.kind, category: best.category, cost, candidatesEvaluated: candidates.length };
}
