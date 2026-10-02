import { BillingCategory, MessageKind, Money, TemplateCategory, type Decimal } from "@wco/domain";
import type { CostEngine } from "@wco/pricing";
import { analyzeCategory, FINAL_CATEGORY_DISCLAIMER, templateText, type CategoryAnalysis } from "./category-analyzer";

/**
 * Template Cost Analyzer (spec §65). Estimates the cost of a template at a given volume using the
 * category assigned by Meta (or the declared one if Meta has not reported yet) and flags a possible
 * mismatch with the deterministic analyzer. It never modifies templates and never proposes wording
 * to change the category.
 */
export interface TemplateCostInput {
  components: unknown;
  declaredCategory: TemplateCategory;
  metaCategory?: TemplateCategory | null;
  market: string;
  currency: string;
  monthlyVolume: number;
  date: Date;
  timezone: string;
}

export interface TemplateCostResult {
  analysis: CategoryAnalysis;
  billedCategory: TemplateCategory;
  estimatedRate: string | null;
  estimatedMonthlyCost: string | null;
  alternative: { category: TemplateCategory; rate: string | null; monthlyCost: string | null } | null;
  alerts: string[];
  disclaimer: string;
  isDemoRate: boolean;
  policyVersion: string | null;
}

export function analyzeTemplateCost(input: TemplateCostInput, engine: CostEngine): TemplateCostResult {
  const analysis = analyzeCategory(templateText(input.components));
  const billed = input.metaCategory ?? input.declaredCategory;
  const price = (category: TemplateCategory) => {
    const r = engine.evaluate({
      category: category as BillingCategory,
      messageKind: MessageKind.TEMPLATE,
      at: input.date,
      timezone: input.timezone,
      market: input.market,
      currency: input.currency,
      businessPhoneNumberId: "analysis",
      conversation: { customerServiceWindow: { lastInboundAt: null }, freeEntryPoint: null },
      tierPosition: 0,
      explain: false,
    });
    return r;
  };
  const monthly = (category: TemplateCategory): { rate: string | null; cost: string | null } => {
    const r = price(category);
    if (!r.rate) return { rate: null, cost: null };
    // Price the whole month through the tier calculator (marginal tiers), never "volume × list rate".
    const billingDate = r.billingDate;
    const card = engine.rates.select(input.currency, billingDate);
    const priced = card?.calculator(r.market, r.category, billingDate);
    const cost: Decimal = priced ? priced.calc.cost(0, input.monthlyVolume).total : new Money(r.rate).times(input.monthlyVolume);
    return { rate: r.rate.toString(), cost: cost.toDecimalPlaces(4).toFixed(4) };
  };
  const main = monthly(billed);
  const r = price(billed);
  const alerts: string[] = [];
  let alternative: TemplateCostResult["alternative"] = null;
  if (analysis.category !== "SERVICE" && analysis.category !== billed) {
    const alt = monthly(analysis.category);
    alternative = { category: analysis.category, rate: alt.rate, monthlyCost: alt.cost };
    if (analysis.category === TemplateCategory.UTILITY && billed === TemplateCategory.MARKETING) alerts.push("Possible utility");
    if (analysis.category === TemplateCategory.MARKETING && billed === TemplateCategory.UTILITY) {
      alerts.push("Likely marketing");
      alerts.push("Meta may recategorize utility templates with promotional content to marketing (and restricts repeated misuse).");
    }
    if (analysis.category === TemplateCategory.AUTHENTICATION) alerts.push("Looks like an OTP: only authentication templates may carry passcodes.");
  }
  if (input.metaCategory && input.metaCategory !== input.declaredCategory) {
    alerts.push(`Meta assigned ${input.metaCategory} (declared ${input.declaredCategory}); billing follows Meta's category.`);
  }
  alerts.push(FINAL_CATEGORY_DISCLAIMER);
  return {
    analysis,
    billedCategory: billed,
    estimatedRate: main.rate,
    estimatedMonthlyCost: main.cost,
    alternative,
    alerts,
    disclaimer: FINAL_CATEGORY_DISCLAIMER,
    isDemoRate: r.isDemoRate,
    policyVersion: r.policyVersion,
  };
}
