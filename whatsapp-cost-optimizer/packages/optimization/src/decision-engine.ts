import {
  BillingCategory,
  DecisionAction,
  MessageKind,
  MessageStatus,
  Money,
  OpportunityType,
  PricingStatus,
  Priority,
  maxDate,
  type Decimal,
} from "@wco/domain";
import { isNeverDelayEvent, type PolicyEngineResult } from "@wco/policy";
import type { CostDecision } from "@wco/pricing";
import { detectDuplicate } from "./dedup";
import { priceAt, schedule } from "./scheduler";
import { detectSupersession } from "./supersession";
import { ALL_FEATURES, type DecisionInput, type OptimizationDecision, type OptimizationOpportunity } from "./types";

const ZERO: Decimal = new Money(0);

const NEXT_STATUS: Record<DecisionAction, MessageStatus> = {
  SEND_NOW: MessageStatus.READY_TO_SEND,
  DELAY: MessageStatus.DELAYED,
  CONSOLIDATE: MessageStatus.DELAYED,
  SUPERSEDE: MessageStatus.SUPERSEDED,
  SUPPRESS_DUPLICATE: MessageStatus.DEDUPLICATED,
  BLOCK: MessageStatus.BLOCKED,
  CANCEL: MessageStatus.CANCELLED,
};

/**
 * OptimizationDecisionEngine (spec §32, §80). Deterministic: same inputs → same decision.
 *
 *  1 validate policy · 2 consent · 3 opt-out · 4 already sent · 5 duplicate · 6 supersession ·
 *  7 criticality · 8–11 context, service window, free entry point, free quota · 12 category ·
 *  13 aggregation · 14 cost · 15 alternative cost · 16 choose action (PolicyEngine) ·
 *  17 explanation · 18 enqueue (caller).
 */
export function decide(input: DecisionInput): OptimizationDecision {
  const { intent, policy, now, related, consent, conversation, pricing, rules } = input;
  const features = input.features ?? ALL_FEATURES;
  const margin = input.windowSafetyMarginSeconds ?? 120;
  const explain = input.explain ?? true;
  const notes: string[] = [];

  // 1. policy
  if (!policy.enabled) notes.push(`Optimization policy for ${policy.eventType} is disabled; sending without optimization.`);

  // 4–5. duplicates
  const dedupEnabled = features.deduplication && intent.allowDeduplication && policy.allowDeduplication;
  const dup = dedupEnabled ? detectDuplicate(intent, related, policy.dedupWindowSeconds, now) : { duplicate: false, alreadySent: false, duplicateOf: null };

  // 6. supersession
  const supersessionEnabled = features.supersession && features.debounce && !!intent.supersessionKey;
  const sup = supersessionEnabled ? detectSupersession(intent, related) : { supersededBy: null, supersedes: [], effectiveDeadline: intent.deadlineAt };

  // 7. criticality (never delayed, spec §9/§64/§99)
  const isAuth = intent.category === BillingCategory.AUTHENTICATION || intent.category === BillingCategory.AUTHENTICATION_INTERNATIONAL;
  const neverDelay = isNeverDelayEvent(intent.eventType);
  const bypassBuffer =
    intent.priority === Priority.CRITICAL || isAuth || intent.mustSendImmediately || policy.requiresImmediateDelivery || neverDelay || !policy.enabled;
  const effectiveDeadline = sup.effectiveDeadline;
  const maxDelayExceeded = now >= effectiveDeadline && intent.maxDelaySeconds > 0;
  const buffering = features.debounce && !bypassBuffer && effectiveDeadline > now;
  const canAggregate = buffering && features.aggregation && !!intent.consolidationKey;

  // 8–15. windows, quota, category, cost and alternative cost (smart scheduler)
  const sched = schedule({
    intent,
    policy,
    now,
    deadline: effectiveDeadline,
    conversation,
    pricing,
    features,
    bypassBuffer,
    safetyMarginSeconds: margin,
    wantsBuffer: buffering && (policy.debounceSeconds > 0 || canAggregate),
    explain,
  });
  const probe = sched.cost.eligibility.windows;
  const baselineAt = maxDate(now, intent.preferredSendAt)!;
  const baselineCost = priceAt(intent, baselineAt, intent.messageKind, intent.category, conversation, pricing, explain, "BASELINE");
  const alternativeCost: CostDecision | null =
    sched.messageKind !== intent.messageKind || sched.sendAt.getTime() !== baselineAt.getTime() ? baselineCost : null;

  const nonTemplateOutsideWindow = sched.mode === "CANCEL" && intent.messageKind === MessageKind.NON_TEMPLATE;
  const canDelay = buffering && sched.sendAt > now;

  const facts = {
    noOptIn: consent.requireOptIn && !consent.optedIn && intent.messageKind === MessageKind.TEMPLATE,
    optedOut: consent.optedOut,
    marketingOptedOut: consent.marketingOptedOut,
    isMarketing: intent.category === BillingCategory.MARKETING || intent.category === BillingCategory.MARKETING_LITE,
    nonTemplateOutsideWindow,
    alreadySent: dup.alreadySent,
    duplicate: dup.duplicate,
    superseded: sup.supersededBy !== null,
    supersedesPending: sup.supersedes.length > 0,
    critical: intent.priority === Priority.CRITICAL,
    authentication: isAuth,
    mustSendImmediately: intent.mustSendImmediately,
    requiresImmediateDelivery: policy.requiresImmediateDelivery,
    neverDelayEvent: neverDelay,
    bypassBuffer,
    canAggregate: canAggregate && sched.mode !== "CANCEL",
    canDelay: canDelay && sched.mode !== "CANCEL",
    maxDelayExceeded,
    freeWindowOpen: probe.freeEntryPoint.open || (probe.customerServiceWindow.open && sched.cost.isFree),
    freeWindowClosesBeforeDeadline:
      (!!probe.freeEntryPoint.expiresAt && probe.freeEntryPoint.expiresAt < effectiveDeadline) ||
      (probe.customerServiceWindow.open && !!probe.customerServiceWindow.expiresAt && probe.customerServiceWindow.expiresAt < effectiveDeadline),
    customerServiceWindowOpen: probe.customerServiceWindow.open,
    freeEntryPointOpen: probe.freeEntryPoint.open,
    priority: intent.priority,
    maxDelaySeconds: intent.maxDelaySeconds,
    category: intent.category,
    eventType: intent.eventType,
  };

  // 16. choose action
  let rule: PolicyEngineResult = rules.evaluate(facts);
  // Non-template outside the window with no other blocking fact: the decision engine must not send it.
  if (sched.mode === "CANCEL" && (rule.action === DecisionAction.SEND_NOW || rule.action === DecisionAction.DELAY || rule.action === DecisionAction.CONSOLIDATE)) {
    rule = { ...rule, action: DecisionAction.BLOCK, reason: "not_sendable_under_policy", invariantApplied: "pricing_not_eligible" };
  }
  const action = rule.action;
  const reasons: string[] = [rule.reason];

  let sendAt: Date | null = null;
  let cost: CostDecision | null = null;
  let estimatedSavings: Decimal = ZERO;
  const opportunities: OptimizationOpportunity[] = [];
  const baselineValue = baselineCost.pricingStatus === PricingStatus.UNKNOWN || baselineCost.pricingStatus === PricingStatus.NOT_ELIGIBLE ? ZERO : baselineCost.estimatedCost;
  const currency = pricing.currency;

  switch (action) {
    case DecisionAction.SEND_NOW:
      sendAt = sched.sendAt <= now || bypassBuffer || maxDelayExceeded ? now : sched.sendAt;
      cost = sendAt === now && sched.sendAt.getTime() !== now.getTime() ? priceAt(intent, now, sched.messageKind, sched.category, conversation, pricing, explain) : sched.cost;
      estimatedSavings = baselineValue.minus(cost.estimatedCost);
      reasons.push(...sched.reasons.filter((r) => r !== "send_now"));
      if (bypassBuffer) {
        if (intent.priority === Priority.CRITICAL) reasons.push("critical_message");
        if (isAuth) reasons.push("authentication_message");
        if (intent.mustSendImmediately) reasons.push("must_send_immediately");
        if (policy.requiresImmediateDelivery) reasons.push("immediate_delivery_required");
        if (neverDelay) reasons.push("never_delay_event_type");
      }
      if (maxDelayExceeded) reasons.push("maxDelayExceeded");
      break;
    case DecisionAction.DELAY:
    case DecisionAction.CONSOLIDATE:
      sendAt = sched.sendAt;
      cost = sched.cost;
      estimatedSavings = baselineValue.minus(cost.estimatedCost);
      reasons.push(...sched.reasons);
      if (action === DecisionAction.CONSOLIDATE) reasons.push("same_customer", intent.businessEntityId ? "same_entity" : "same_group", "not_critical", "awaiting_compatible_updates");
      break;
    case DecisionAction.SUPPRESS_DUPLICATE:
      estimatedSavings = baselineValue;
      reasons.push(dup.alreadySent ? "twin_already_dispatched" : "twin_pending_in_buffer");
      opportunities.push({ type: OpportunityType.DUPLICATE, potentialSaving: baselineValue, currency, confidence: 0.99, description: "Duplicate event suppressed" });
      break;
    case DecisionAction.SUPERSEDE:
      estimatedSavings = baselineValue;
      reasons.push("newer_state_for_same_entity", "previous_intent_not_sent");
      opportunities.push({ type: OpportunityType.SUPERSESSION, potentialSaving: baselineValue, currency, confidence: 0.95, description: "Older update superseded by a newer one" });
      break;
    default:
      break;
  }

  if (cost && cost.isFree && !baselineCost.isFree && baselineValue.isPositive()) {
    opportunities.push({
      type: cost.pricingStatus === PricingStatus.QUOTA ? OpportunityType.FREE_QUOTA : OpportunityType.FREE_WINDOW,
      potentialSaving: baselineValue.minus(cost.estimatedCost),
      currency,
      confidence: cost.eligibility.windows.freeEntryPoint.verification === "CONFIRMED" ? 0.95 : 0.8,
      description: cost.freeReason ?? "free",
    });
  }
  if (sup.supersedes.length > 0) reasons.push(`supersedes_${sup.supersedes.length}_pending`);

  // 17. explanation
  const explanation: string[] = [...notes];
  if (explain) explanation.push(`Decision ${action} (${rule.reason}${rule.invariantApplied ? `, invariant ${rule.invariantApplied}` : ""}) by rule set "${rule.ruleSet}".`);
  if (explain && dup.duplicate) explanation.push(`Same event already ${dup.alreadySent ? "sent" : "buffered"} (intent ${dup.duplicateOf}).`);
  if (explain && sup.supersededBy) explanation.push(`A newer update for the same entity is pending (intent ${sup.supersededBy}).`);
  if (explain && sup.supersedes.length) explanation.push(`Replaces ${sup.supersedes.length} older pending update(s); deadline kept at ${effectiveDeadline.toISOString()}.`);
  if (explain && sendAt) explanation.push(`Send at ${sendAt.toISOString()} as ${sched.messageKind === MessageKind.TEMPLATE ? "template" : "free-form service message"} (${sched.category}).`);
  if (explain && cost) explanation.push(...cost.evidence.map((e) => `Pricing: ${e}`));

  return {
    intentId: intent.id,
    action,
    nextStatus: NEXT_STATUS[action],
    sendAt,
    reasons: [...new Set(reasons)],
    rule,
    facts,
    supersedes: action === DecisionAction.SEND_NOW || action === DecisionAction.DELAY || action === DecisionAction.CONSOLIDATE ? sup.supersedes : [],
    supersededBy: action === DecisionAction.SUPERSEDE ? sup.supersededBy : null,
    duplicateOf: action === DecisionAction.SUPPRESS_DUPLICATE ? dup.duplicateOf : null,
    effectiveDeadline,
    messageKind: sched.messageKind,
    category: sched.category,
    cost,
    baselineCost,
    alternativeCost,
    estimatedSavings,
    currency,
    opportunities,
    explanation,
  };
}
