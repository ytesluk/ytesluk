import { BillingCategory, FreeCondition, Money, money, percentage, type Decimal } from "@wco/domain";
import { bspCost, type BspFeeModel } from "./bsp";
import type { PolicyRegistry } from "./policy";
import type { RateCatalog } from "./rate-card";
import type { TierSlice } from "./tier-calculator";

/**
 * Rate Card Simulator (spec §16) — analytical, single market/category, one month.
 * Uses the SAME policy and rate-card data as the production engine (no duplicated pricing logic).
 * Output is an ESTIMATE.
 */
export interface RateCardSimulationInput {
  /** Local date used to select the policy and the rate card (YYYY-MM-DD). */
  date: string;
  market: string;
  currency: string;
  category: BillingCategory;
  monthlyMessages: number;
  /** Charged messages already accrued this month for the same market/category (portfolio). */
  currentTierPosition?: number;
  /** 0..1 */
  deliveryRate: number;
  /** Free quota available (e.g. service messages per number); defaults to the policy quota × phoneNumbers. */
  freeQuota?: number;
  phoneNumbers?: number;
  /** Share (0..100) of delivered messages that fall inside free entry point windows. */
  fepPercent: number;
  /** Share (0..100) of delivered messages that fall inside customer service windows. */
  serviceWindowPercent: number;
  bsp?: BspFeeModel;
  /** Own infrastructure cost per message sent (provider call, queue, storage). */
  infraFeePerMessage?: string;
  /** Message reduction assumed from WCO (dedup/supersession/consolidation), 0..100. */
  optimizationReductionPercent?: number;
  /** Additional share (percentage points) of paid messages moved into free windows by scheduling, 0..100. */
  windowShiftPercent?: number;
}

export interface ScenarioCost {
  messagesSent: number;
  delivered: number;
  freeEntryPoint: number;
  freeServiceWindow: number;
  freeQuota: number;
  charged: number;
  metaCost: string;
  bspCost: string;
  infraCost: string;
  totalCost: string;
  tiers: Array<{ label: string; count: number; rate: string; subtotal: string }>;
}

export interface RateCardSimulationResult {
  currency: string;
  policyVersion: string | null;
  rateCard: string | null;
  isDemoRate: boolean;
  baseline: ScenarioCost;
  optimized: ScenarioCost;
  savings: { meta: string; bsp: string; infrastructure: string; total: string; percent: string | null };
  label: "ESTIMATED";
  warnings: string[];
}

export function simulateRateCard(input: RateCardSimulationInput, policies: PolicyRegistry, rates: RateCatalog): RateCardSimulationResult {
  const warnings: string[] = [];
  const policy = policies.forDate(input.date);
  const card = rates.select(input.currency, input.date);
  if (!policy) warnings.push(`No active pricing policy on ${input.date}`);
  if (!card) warnings.push(`No rate card for ${input.currency} on ${input.date}`);
  if (card?.meta.isDemo) warnings.push("Rates come from a DEMO rate card (fictitious values).");

  const rule = policy?.ruleFor(input.category, input.market);
  const priced = card && rule ? (card.calculator(input.market, rule.rateCategory ?? input.category, input.date) ?? (rule.rateCategoryFallback ? card.calculator(input.market, rule.rateCategoryFallback, input.date) : null)) : null;
  if (rule && !priced && rule.billable && !rule.freeEligibility.includes(FreeCondition.ALWAYS)) {
    warnings.push(`No rate for ${input.category} in ${input.market}`);
  }

  const quotaAvailable = input.freeQuota ?? (rule?.freeQuota ? rule.freeQuota.amount * (input.phoneNumbers ?? 1) : 0);

  const scenario = (messages: number, extraFreeShiftPct: number): ScenarioCost => {
    const delivered = Math.round(messages * input.deliveryRate);
    let remaining = delivered;
    const alwaysFree = !rule || !rule.billable || rule.freeEligibility.includes(FreeCondition.ALWAYS);
    const fepPct = Math.min(100, input.fepPercent + extraFreeShiftPct);
    const fep = rule?.freeEligibility.includes(FreeCondition.FREE_ENTRY_POINT) ? Math.round(delivered * (fepPct / 100)) : 0;
    remaining -= fep;
    const csw = rule?.freeEligibility.includes(FreeCondition.CUSTOMER_SERVICE_WINDOW)
      ? Math.min(remaining, Math.round(delivered * (input.serviceWindowPercent / 100)))
      : 0;
    remaining -= csw;
    const quota = rule?.freeQuota ? Math.min(remaining, quotaAvailable) : 0;
    remaining -= quota;
    const charged = alwaysFree ? 0 : Math.max(0, remaining);
    let meta: Decimal = new Money(0);
    let slices: TierSlice[] = [];
    if (charged > 0 && priced) {
      const r = rule!.tiered ? priced.calc.cost(input.currentTierPosition ?? 0, charged) : { total: priced.calc.rateAt(1).times(charged), slices: [] };
      meta = r.total;
      slices = r.slices;
    }
    const bsp = bspCost(input.bsp, { metaCost: meta, messagesSent: messages, billableMessages: charged }).total;
    const infra = money(input.infraFeePerMessage ?? 0).times(messages);
    const f = (d: Decimal) => d.toDecimalPlaces(4).toFixed(4);
    return {
      messagesSent: messages,
      delivered,
      freeEntryPoint: alwaysFree ? 0 : fep,
      freeServiceWindow: alwaysFree ? delivered : csw,
      freeQuota: alwaysFree ? 0 : quota,
      charged,
      metaCost: f(meta),
      bspCost: f(bsp),
      infraCost: f(infra),
      totalCost: f(meta.plus(bsp).plus(infra)),
      tiers: slices.map((s) => ({ label: s.label, count: s.count, rate: s.rate.toString(), subtotal: f(s.subtotal) })),
    };
  };

  const baseline = scenario(input.monthlyMessages, 0);
  const optimizedMessages = Math.round(input.monthlyMessages * (1 - (input.optimizationReductionPercent ?? 0) / 100));
  const optimized = scenario(optimizedMessages, input.windowShiftPercent ?? 0);
  const d = (a: string, b: string) => money(a).minus(money(b));
  const total = d(baseline.totalCost, optimized.totalCost);
  const pct = percentage(total, baseline.totalCost);
  return {
    currency: input.currency,
    policyVersion: policy?.id ?? null,
    rateCard: card?.meta.name ?? null,
    isDemoRate: card?.meta.isDemo ?? false,
    baseline,
    optimized,
    savings: {
      meta: d(baseline.metaCost, optimized.metaCost).toFixed(4),
      bsp: d(baseline.bspCost, optimized.bspCost).toFixed(4),
      infrastructure: d(baseline.infraCost, optimized.infraCost).toFixed(4),
      total: total.toFixed(4),
      percent: pct ? pct.toFixed(2) : null,
    },
    label: "ESTIMATED",
    warnings,
  };
}
