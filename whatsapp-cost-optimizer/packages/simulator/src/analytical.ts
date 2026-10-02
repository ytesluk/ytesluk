import { BillingCategory, money, percentage, type Decimal } from "@wco/domain";
import { simulateRateCard, type BspFeeModel, type PolicyRegistry, type RateCatalog } from "@wco/pricing";

/**
 * "Simular Economia" (spec §37) — fast analytical model for the dashboard. It reuses the production
 * pricing rules/rate cards through `simulateRateCard`, applies message-reduction rates by category
 * and reports baseline vs optimized. Label: "Resultado estimado" — never a guaranteed saving.
 *
 * Assumptions (shown in the UI):
 *  - duplicates can be removed from every category (identical re-emissions);
 *  - supersession and consolidation apply to utility (status updates) only;
 *  - FEP-free share is the same in both scenarios (Meta applies it regardless of WCO) unless an explicit
 *    "window capture improvement" is given;
 *  - the service free quota is per business phone number per month.
 */
export interface SavingsSimulationInput {
  date: string;
  market: string;
  currency: string;
  customers: number;
  monthlyMessages: number;
  mix: { marketing: number; utility: number; authentication: number; service: number };
  duplicateRate: number;
  consolidationRate: number;
  supersessionRate: number;
  fepEligibilityPercent: number;
  /** Extra share (percentage points) of paid messages moved into free windows by scheduling (assumption). */
  windowCaptureImprovement?: number;
  freeQuotaPerPhoneNumber?: number;
  phoneNumbers: number;
  currentTierPosition?: number;
  deliveryRate?: number;
  bsp?: BspFeeModel;
  infraFeePerMessage?: string;
}

export interface SavingsSimulationResult {
  label: "Resultado estimado";
  currency: string;
  policyVersion: string | null;
  isDemoRate: boolean;
  byCategory: Array<{ category: BillingCategory; baselineMessages: number; optimizedMessages: number; baselineMeta: string; optimizedMeta: string }>;
  baseline: { messages: number; meta: string; bsp: string; infra: string; total: string };
  optimized: { messages: number; meta: string; bsp: string; infra: string; total: string };
  savings: { meta: string; bsp: string; infra: string; total: string; percent: string | null; messagesAvoided: number };
  assumptions: string[];
  warnings: string[];
}

export function simulateSavings(input: SavingsSimulationInput, policies: PolicyRegistry, rates: RateCatalog): SavingsSimulationResult {
  const mixTotal = input.mix.marketing + input.mix.utility + input.mix.authentication + input.mix.service || 1;
  const cats: Array<[BillingCategory, number]> = [
    [BillingCategory.MARKETING, input.mix.marketing],
    [BillingCategory.UTILITY, input.mix.utility],
    [BillingCategory.AUTHENTICATION, input.mix.authentication],
    [BillingCategory.SERVICE, input.mix.service],
  ];
  const warnings = new Set<string>();
  const byCategory: SavingsSimulationResult["byCategory"] = [];
  const acc = { bm: money(0), om: money(0), bb: money(0), ob: money(0), bi: money(0), oi: money(0), bmsg: 0, omsg: 0 };
  let policyVersion: string | null = null;
  let isDemo = false;
  for (const [category, share] of cats) {
    const messages = Math.round((input.monthlyMessages * share) / mixTotal);
    if (messages <= 0) continue;
    let reduction = input.duplicateRate;
    if (category === BillingCategory.UTILITY) reduction = 1 - (1 - input.duplicateRate) * (1 - input.supersessionRate) * (1 - input.consolidationRate);
    if (category === BillingCategory.SERVICE) reduction = 0;
    const r = simulateRateCard(
      {
        date: input.date,
        market: input.market,
        currency: input.currency,
        category,
        monthlyMessages: messages,
        currentTierPosition: input.currentTierPosition,
        deliveryRate: input.deliveryRate ?? 0.97,
        freeQuota: category === BillingCategory.SERVICE && input.freeQuotaPerPhoneNumber !== undefined ? input.freeQuotaPerPhoneNumber * input.phoneNumbers : undefined,
        phoneNumbers: input.phoneNumbers,
        fepPercent: input.fepEligibilityPercent,
        serviceWindowPercent: category === BillingCategory.SERVICE ? 100 : 0,
        bsp: input.bsp,
        infraFeePerMessage: input.infraFeePerMessage,
        optimizationReductionPercent: Math.round(reduction * 10000) / 100,
        windowShiftPercent: input.windowCaptureImprovement ?? 0,
      },
      policies,
      rates,
    );
    r.warnings.forEach((w) => warnings.add(w));
    policyVersion = r.policyVersion;
    isDemo = r.isDemoRate;
    byCategory.push({ category, baselineMessages: r.baseline.messagesSent, optimizedMessages: r.optimized.messagesSent, baselineMeta: r.baseline.metaCost, optimizedMeta: r.optimized.metaCost });
    acc.bm = acc.bm.plus(r.baseline.metaCost);
    acc.om = acc.om.plus(r.optimized.metaCost);
    acc.bb = acc.bb.plus(r.baseline.bspCost);
    acc.ob = acc.ob.plus(r.optimized.bspCost);
    acc.bi = acc.bi.plus(r.baseline.infraCost);
    acc.oi = acc.oi.plus(r.optimized.infraCost);
    acc.bmsg += r.baseline.messagesSent;
    acc.omsg += r.optimized.messagesSent;
  }
  const f = (d: Decimal) => d.toDecimalPlaces(2).toFixed(2);
  const bt = acc.bm.plus(acc.bb).plus(acc.bi);
  const ot = acc.om.plus(acc.ob).plus(acc.oi);
  const pct = percentage(bt.minus(ot), bt);
  return {
    label: "Resultado estimado",
    currency: input.currency,
    policyVersion,
    isDemoRate: isDemo,
    byCategory,
    baseline: { messages: acc.bmsg, meta: f(acc.bm), bsp: f(acc.bb), infra: f(acc.bi), total: f(bt) },
    optimized: { messages: acc.omsg, meta: f(acc.om), bsp: f(acc.ob), infra: f(acc.oi), total: f(ot) },
    savings: {
      meta: f(acc.bm.minus(acc.om)),
      bsp: f(acc.bb.minus(acc.ob)),
      infra: f(acc.bi.minus(acc.oi)),
      total: f(bt.minus(ot)),
      percent: pct ? pct.toFixed(2) : null,
      messagesAvoided: acc.bmsg - acc.omsg,
    },
    assumptions: [
      "Duplicatas removíveis em todas as categorias; supersession e consolidação aplicadas apenas a Utility.",
      "Mensagens dentro de janelas FEP são gratuitas nos dois cenários (a Meta aplica a regra independentemente do WCO).",
      "Cota gratuita de Service por número de telefone por mês, conforme a política vigente na data.",
      "Volume tiers calculados de forma marginal a partir da posição atual no mês.",
    ],
    warnings: [...warnings],
  };
}
