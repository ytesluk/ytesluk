import { BillingCategory, MessageKind, PricingStatus, RoutingReason, addSeconds, billingMonth, maxDate, minDate } from "@wco/domain";
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
 * priced by the same CostEngine used for billing. Only windows that are ALREADY open are priced as
 * open — a window the customer might open later is never assumed.
 *
 * Cost routing on top of that (each one opt-in or bounded by the deadline):
 *  - template → free-form: the template's own content goes as a service message while the customer
 *    service window is open, when the policy allows it and it is cheaper (never authentication);
 *  - free entry point priority: a message that would go later is brought forward into an open FEP window;
 *  - frequency cap: a marketing template waits out Meta's per-user limit (131049) when the deadline allows;
 *  - inbound-first: a paid template is held for a short grace so the customer can open the conversation
 *    (the tenant's other channels invite them); at the end of the grace the template is sent anyway.
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
  /** Frequency-cap cooldown: do not send before this instant (applied only up to the deadline). */
  notBefore?: Date | null;
  /** The intent may be held for the policy's inbound-first grace (never for critical/immediate ones). */
  allowInboundFirst?: boolean;
  explain?: boolean;
}

const isMarketing = (c: BillingCategory): boolean => c === BillingCategory.MARKETING || c === BillingCategory.MARKETING_LITE;

/**
 * Whether the intent's content may go as a free-form (service) message when the window is open:
 * utility templates under `allowFreeFormInWindow`, marketing templates only under
 * `allowMarketingFreeFormInWindow`, authentication never. The body is the client's `text` or the
 * template's own content (not for intents that can be consolidated into a summary template).
 */
export function freeFormAlternative(intent: IntentRecord, policy: OptimizationPolicyConfig): boolean {
  if (intent.messageKind !== MessageKind.TEMPLATE) return false;
  const hasBody = !!intent.freeFormText || (intent.templateConvertible === true && !intent.consolidationKey);
  if (!hasBody) return false;
  if (intent.category === BillingCategory.UTILITY) return policy.allowFreeFormInWindow;
  if (isMarketing(intent.category)) return policy.allowMarketingFreeFormInWindow === true;
  return false;
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
  const reasons: string[] = [];
  const explain = input.explain ?? true;
  // Frequency cap (131049): wait out the cooldown, but never past the deadline the client set.
  const capFloor = !input.bypassBuffer && input.notBefore && input.notBefore > now ? minDate(input.notBefore, deadline) : null;
  const earliest = maxDate(now, intent.earliestSendAt, capFloor)!;
  if (capFloor && capFloor > now && earliest.getTime() === capFloor.getTime()) reasons.push(RoutingReason.DEFERRED_FREQUENCY_CAP);

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
  // Probe windows open at `earliest`: send just before they close.
  const probe = priceAt(intent, earliest, intent.messageKind, intent.category, conversation, pricing, false);
  const w = probe.eligibility.windows;
  {
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
  // Never for AUTHENTICATION (spec §99); MARKETING only when the policy opts in.
  const freeFormAllowed = features.pricingOptimizer && freeFormAlternative(intent, policy);
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
  // Inbound-first: the template would be paid, no window is open, and the same content can go as a
  // free-form message if the customer writes first. Hold it until the grace ends (never past the
  // deadline); if nobody writes, the template goes then, exactly as it would have.
  const graceSeconds = (policy.inboundFirstGraceMinutes ?? 0) * 60;
  if (input.allowInboundFirst && graceSeconds > 0 && freeFormAllowed && !w.customerServiceWindow.open && best.kind === MessageKind.TEMPLATE && best.cost.pricingStatus === PricingStatus.PAID) {
    const until = minDate(addSeconds(best.at, graceSeconds), effectiveDeadline)!;
    if (until > now && until > best.at) {
      const cost = priceAt(intent, until, intent.messageKind, intent.category, conversation, pricing, explain);
      reasons.push(RoutingReason.INBOUND_FIRST_WAIT, "send_at_inbound_first_grace_end");
      return { sendAt: until, mode: "SEND_AT", reasons, messageKind: intent.messageKind, category: intent.category, cost, candidatesEvaluated: candidates.length };
    }
  }

  // Re-price the winner with full evidence for the audit trail.
  const cost = explain ? priceAt(intent, best.at, best.kind, best.category, conversation, pricing, true) : best.cost;
  if (best.kind !== intent.messageKind) {
    reasons.push("free_form_service_message_cheaper_inside_window");
    // The body is the template's own content (no client text): template → free-form substitution.
    if (!intent.freeFormText) reasons.push(RoutingReason.TEMPLATE_TO_FREEFORM_CSW);
  }
  if (best.label.startsWith("before_")) reasons.push(best.label);
  // Brought forward into an open free entry point window (it would have gone later, outside it or paid).
  if (best.cost.freeReason === "free_entry_point_window" && best.at.getTime() < target.getTime()) reasons.push(RoutingReason.FEP_PRIORITY);
  const mode = best.at.getTime() <= now.getTime() ? "SEND_NOW" : "SEND_AT";
  reasons.push(mode === "SEND_NOW" ? "send_now" : `send_at_${best.label}`);
  return { sendAt: best.at, mode, reasons, messageKind: best.kind, category: best.category, cost, candidatesEvaluated: candidates.length };
}

/**
 * Order of the dispatch queue (lower = first). Critical/immediate messages always lead; then high
 * priority; then messages inside a free entry point window, which must leave before it closes;
 * then the rest. Never used to send more messages — only to order the ones already decided.
 */
export function dispatchRank(input: { bypassBuffer: boolean; priority: IntentRecord["priority"]; freeEntryPointOpen: boolean }): number {
  if (input.bypassBuffer || input.priority === "CRITICAL") return 0;
  if (input.priority === "HIGH") return 1;
  if (input.freeEntryPointOpen) return 2;
  return input.priority === "LOW" ? 4 : 3;
}
