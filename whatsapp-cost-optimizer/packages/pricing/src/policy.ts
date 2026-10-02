import {
  BillingCategory,
  BillingEvent,
  FreeCondition,
  MessageKind,
  Money,
  PolicyStatus,
  PricingStatus,
  billingMonth,
  isWithinLocalDates,
  localDate,
  resolveMarket,
  type Decimal,
} from "@wco/domain";
import type { RateCard } from "./rate-card";
import type { CategoryRule, PolicyDefinition, PricingContext, PricingEligibilityResult, TierInfo } from "./types";
import { evaluateWindows } from "./windows";

const ZERO: Decimal = new Money(0);

/**
 * A pricing policy version. ALL billing rules live in its definition (data); this class only
 * interprets them. Usage (spec §4):
 *
 *   pricingPolicy.evaluate({ category, at, businessPhoneNumberId, conversation, ... }, rateCard)
 */
export class PricingPolicy {
  constructor(readonly definition: PolicyDefinition) {}

  get id(): string {
    return this.definition.id;
  }

  appliesOn(billingDate: string): boolean {
    return isWithinLocalDates(billingDate, this.definition.effectiveFrom, this.definition.effectiveUntil);
  }

  ruleFor(category: BillingCategory, market: string): CategoryRule | undefined {
    const rules = this.definition.rules.filter((r) => r.category === category);
    return rules.find((r) => r.market === market) ?? rules.find((r) => r.market === "*");
  }

  evaluate(ctx: PricingContext, rateCard: RateCard | null): PricingEligibilityResult {
    const def = this.definition;
    const billingDate = localDate(ctx.at, ctx.timezone);
    const month = billingMonth(ctx.at, ctx.timezone);
    const evidence: string[] = [];
    const ex = ctx.explain !== false;

    let market = ctx.market;
    let mappingVersion = "provided";
    if (!market) {
      if (!ctx.recipient) throw new Error("PricingContext requires recipient or market");
      const resolved = resolveMarket(ctx.recipient, billingDate);
      market = resolved.market;
      mappingVersion = resolved.mappingVersion;
      if (ex) evidence.push(
        `Market ${market} resolved from recipient calling code +${resolved.callingCodePrefix ?? "?"} (mapping ${resolved.mappingVersion})`,
      );
    } else {
      if (ex) evidence.push(`Market ${market}`);
    }

    const windows = evaluateWindows(def, ctx.conversation, ctx.at);
    const base = {
      market,
      marketMappingVersion: mappingVersion,
      currency: rateCard?.meta.currency ?? null,
      policyVersion: def.id,
      rateCardId: rateCard?.id ?? null,
      isDemoRate: rateCard?.meta.isDemo ?? false,
      billingDate,
      billingMonth: month,
      chargedOn: def.billingEvent,
      windows,
    };

    // Authentication-international: Meta decides eligibility and notifies the business; the rate card
    // must contain the market's authentication-international rate.
    let category = ctx.category;
    if (
      category === BillingCategory.AUTHENTICATION &&
      ctx.authInternationalEligible &&
      rateCard?.hasCategory(market, BillingCategory.AUTHENTICATION_INTERNATIONAL)
    ) {
      category = BillingCategory.AUTHENTICATION_INTERNATIONAL;
      if (ex) evidence.push("Business eligible for authentication-international rates in this market");
    }

    const rule = this.ruleFor(category, market);
    const unknown = (reason: string, note: string): PricingEligibilityResult => ({
      ...base,
      status: PricingStatus.UNKNOWN,
      eligible: false,
      reason,
      category,
      rate: null,
      listRate: null,
      freeReason: null,
      tier: null,
      countsTowardTier: false,
      quota: null,
      evidence: [...evidence, note],
    });

    if (ex) evidence.push(`Pricing policy ${def.id} (${def.effectiveFrom} → ${def.effectiveUntil ?? "open"}), billing date ${billingDate} (WABA timezone ${ctx.timezone})`);
    if (!rule) return unknown("no_rule_for_category", `Policy ${def.id} has no rule for ${category}`);

    if (rule.messageKind !== ctx.messageKind) {
      if (ex) evidence.push(`Category ${category} is a ${rule.messageKind.toLowerCase()} category`);
    }

    if (rule.requiresCustomerServiceWindow && !windows.customerServiceWindow.open) {
      return {
        ...unknown("non_template_outside_customer_service_window", "Non-template messages can only be sent inside an open 24h customer service window (Meta error 131047)."),
        status: PricingStatus.NOT_ELIGIBLE,
      };
    }

    if (rule.unit === "TOKEN") {
      return unknown("token_based_pricing_not_modeled", "Meta Business Agent messages are priced per token; WCO does not send them.");
    }

    // ---- rate lookup (needed for FREE results too: "what it would have cost")
    const rateCategory = rule.rateCategory ?? category;
    let priced = rateCard?.calculator(market, rateCategory, billingDate) ?? null;
    let pricedCategory = rateCategory;
    if (!priced && rule.rateCategoryFallback && rateCard) {
      priced = rateCard.calculator(market, rule.rateCategoryFallback, billingDate);
      pricedCategory = rule.rateCategoryFallback;
      if (priced && ex) evidence.push(`Rate card has no ${rateCategory} row; using ${rule.rateCategoryFallback} rate as defined by the policy`);
    }
    const listRate = priced ? priced.calc.rateAt(1) : null;

    const free = (freeReason: string, status: PricingStatus, note: string, quota: PricingEligibilityResult["quota"] = null): PricingEligibilityResult => ({
      ...base,
      status,
      eligible: true,
      reason: freeReason,
      category,
      rate: ZERO,
      listRate,
      freeReason,
      tier: null,
      countsTowardTier: false,
      quota,
      evidence: [...evidence, note],
    });

    // ---- free conditions (order: always → FEP → CSW), then quota
    if (!rule.billable || rule.freeEligibility.includes(FreeCondition.ALWAYS)) {
      return free("not_billable_under_policy", PricingStatus.FREE, `${category} messages are not charged under ${def.id}`);
    }
    if (rule.freeEligibility.includes(FreeCondition.FREE_ENTRY_POINT) && windows.freeEntryPoint.open) {
      const note = windows.freeEntryPoint.opensOnThisMessage
        ? "First reply within 24h of a free entry point message: free, and opens a free entry point window"
        : `Inside an open free entry point window (until ${windows.freeEntryPoint.expiresAt?.toISOString()})`;
      return free("free_entry_point_window", PricingStatus.FREE, `${note} [verification: ${windows.freeEntryPoint.verification ?? "n/a"}]`);
    }
    if (rule.freeEligibility.includes(FreeCondition.CUSTOMER_SERVICE_WINDOW) && windows.customerServiceWindow.open) {
      return free(
        "customer_service_window",
        PricingStatus.FREE,
        `Delivered inside an open customer service window (until ${windows.customerServiceWindow.expiresAt?.toISOString()}); ${category} is free in-window under ${def.id}`,
      );
    }
    if (ex) evidence.push(windows.freeEntryPoint.open ? "" : "No active free entry point window");
    if (ex && rule.freeEligibility.includes(FreeCondition.CUSTOMER_SERVICE_WINDOW)) evidence.push("No open customer service window");
    else if (ex && windows.customerServiceWindow.open) evidence.push(`Open customer service window does not make ${category} free under ${def.id}`);

    if (rule.freeQuota) {
      const used = ctx.quotaUsed ?? 0;
      const quota = {
        scope: rule.freeQuota.scope,
        scopeKey: ctx.businessPhoneNumberId,
        periodKey: month,
        amount: rule.freeQuota.amount,
        usedBefore: used,
      };
      if (used < rule.freeQuota.amount) {
        return free("free_monthly_quota", PricingStatus.QUOTA, `Free quota ${used + 1}/${rule.freeQuota.amount} (${rule.freeQuota.scope}, ${month})`, quota);
      }
      if (ex) evidence.push(`Free quota exhausted (${used}/${rule.freeQuota.amount}, ${month})`);
    }

    if (!priced || !rateCard) {
      return unknown("no_rate_for_market_category", `No rate for ${rateCategory} in market ${market} on ${billingDate} (rate card: ${rateCard?.id ?? "none"})`);
    }

    let tier: TierInfo | null = null;
    let rate = listRate!;
    if (rule.tiered) {
      const position = (ctx.tierPosition ?? 0) + 1;
      tier = rateCard.tierInfo(priced.calc, position);
      rate = priced.calc.rateAt(position);
      if (ex) evidence.push(`Volume tier: message #${position.toLocaleString("en-US")} of the month → ${tier.label}`);
    }
    if (ex) evidence.push(
      `Charged at ${rate.toString()} ${rateCard.meta.currency} (${pricedCategory}, catalog market ${priced.catalogMarket}, rate card ${rateCard.meta.name}${rateCard.meta.isDemo ? " — DEMO RATES" : ""})`,
      `Charged only if delivered (billing event: ${def.billingEvent})`,
    );
    return {
      ...base,
      status: PricingStatus.PAID,
      eligible: false,
      reason: "charged",
      category,
      rate,
      listRate,
      freeReason: null,
      tier,
      countsTowardTier: rule.tiered,
      quota: null,
      evidence: evidence.filter((e) => e !== ""),
    };
  }
}

/** Selects the policy version in force on a local billing date. UNVERIFIED/DRAFT versions are never selected. */
export class PolicyRegistry {
  private readonly policies: PricingPolicy[];

  constructor(definitions: PolicyDefinition[]) {
    this.policies = definitions.map((d) => new PricingPolicy(d));
  }

  all(): PricingPolicy[] {
    return [...this.policies];
  }

  get(id: string): PricingPolicy | undefined {
    return this.policies.find((p) => p.id === id);
  }

  forDate(billingDate: string, opts: { includeUnverified?: boolean } = {}): PricingPolicy | null {
    const allowed = new Set<string>([PolicyStatus.ACTIVE, PolicyStatus.SUPERSEDED]);
    if (opts.includeUnverified) allowed.add(PolicyStatus.UNVERIFIED);
    const matches = this.policies.filter((p) => allowed.has(p.definition.status) && p.appliesOn(billingDate));
    if (matches.length === 0) return null;
    // Prefer ACTIVE over SUPERSEDED/UNVERIFIED, then the most recent start.
    matches.sort((a, b) => {
      const rank = (p: PricingPolicy) => (p.definition.status === PolicyStatus.ACTIVE ? 0 : 1);
      return rank(a) - rank(b) || b.definition.effectiveFrom.localeCompare(a.definition.effectiveFrom);
    });
    return matches[0]!;
  }

  forInstant(at: Date, timezone: string, opts?: { includeUnverified?: boolean }): PricingPolicy | null {
    return this.forDate(localDate(at, timezone), opts);
  }
}

export { BillingEvent, MessageKind };
