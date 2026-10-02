import { Confidence, Money, PricingStatus, localDate, metricsSafe, type Decimal } from "./internal";
import type { PolicyRegistry } from "./policy";
import type { RateCatalog } from "./rate-card";
import type { CostDecision, PricingContext, PricingEligibilityResult } from "./types";

export interface CostEngineInput extends PricingContext {
  messageIntentId?: string;
  /** WABA billing currency (selects the rate card). */
  currency: string;
  kind?: CostDecision["kind"];
  /** Allow UNVERIFIED policies (what-if analysis only). */
  includeUnverifiedPolicies?: boolean;
  /** Force a specific policy version (e.g. recomputing an old invoice). */
  policyVersionId?: string;
}

/**
 * CostEngine (spec §12): MessageIntent (+ context) → CostDecision.
 * Selects the policy and rate card in force on the billing date and records which ones were used.
 */
export class CostEngine {
  constructor(
    readonly policies: PolicyRegistry,
    readonly rates: RateCatalog,
  ) {}

  evaluate(input: CostEngineInput): PricingEligibilityResult {
    const billingDate = localDate(input.at, input.timezone);
    const policy = input.policyVersionId
      ? this.policies.get(input.policyVersionId)
      : this.policies.forDate(billingDate, { includeUnverified: input.includeUnverifiedPolicies });
    const card = this.rates.select(input.currency, billingDate);
    if (!policy) {
      metricsSafe("no_policy");
      return {
        status: PricingStatus.UNKNOWN,
        eligible: false,
        reason: "no_policy_for_date",
        category: input.category,
        market: input.market ?? "UNKNOWN",
        marketMappingVersion: "n/a",
        currency: card?.meta.currency ?? null,
        rate: null,
        listRate: null,
        freeReason: null,
        policyVersion: null,
        rateCardId: card?.id ?? null,
        isDemoRate: card?.meta.isDemo ?? false,
        tier: null,
        countsTowardTier: false,
        quota: null,
        windows: {
          customerServiceWindow: { open: false, expiresAt: null },
          freeEntryPoint: { open: false, expiresAt: null, opensOnThisMessage: false, eligibleForFreeReply: false, verification: null },
        },
        billingDate,
        billingMonth: billingDate.slice(0, 7),
        chargedOn: "DELIVERED",
        evidence: [`No ACTIVE pricing policy covers ${billingDate}; cost is UNKNOWN (never assumed free or paid).`],
      };
    }
    const result = policy.evaluate(input, card);
    if (result.status === PricingStatus.UNKNOWN) metricsSafe(result.reason);
    return result;
  }

  decide(input: CostEngineInput): CostDecision {
    const r = this.evaluate(input);
    return toCostDecision(r, input.kind ?? "OPTIMIZED", input.messageIntentId, input.currency);
  }
}

export function toCostDecision(
  r: PricingEligibilityResult,
  kind: CostDecision["kind"],
  messageIntentId: string | undefined,
  currency: string,
): CostDecision {
  const zero: Decimal = new Money(0);
  const known = r.status !== PricingStatus.UNKNOWN && r.status !== PricingStatus.NOT_ELIGIBLE;
  const effectiveRate = r.rate ?? zero;
  return {
    messageIntentId,
    kind,
    category: r.category,
    market: r.market,
    currency: r.currency ?? currency,
    baseRate: r.listRate,
    effectiveRate,
    isFree: r.status === PricingStatus.FREE || r.status === PricingStatus.QUOTA,
    freeReason: r.freeReason,
    pricingStatus: r.status,
    tier: r.tier?.label ?? null,
    policyVersion: r.policyVersion,
    rateCardId: r.rateCardId,
    isDemoRate: r.isDemoRate,
    estimatedCost: effectiveRate,
    confidence: known ? Confidence.ESTIMATED : Confidence.UNKNOWN,
    decisionReason: r.reason,
    evidence: r.evidence,
    eligibility: r,
  };
}
