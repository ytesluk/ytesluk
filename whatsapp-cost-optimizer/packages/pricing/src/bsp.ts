import { Money, money, type Decimal } from "@wco/domain";

/**
 * BSP (Business Solution Provider) fee model (spec §66). WCO never assumes every BSP charges a markup:
 * NONE is a valid model and the default.
 */
export interface BspFeeModel {
  type: "NONE" | "PERCENTAGE" | "FIXED_PER_MESSAGE" | "MONTHLY" | "MIXED";
  /** % applied over Meta charges (e.g. "10" = 10%). */
  percentOfMeta?: string;
  /** Fixed fee per message. */
  perMessage?: string;
  /** Which messages the per-message fee applies to. */
  perMessageAppliesTo?: "ALL_SENT" | "BILLABLE_ONLY";
  monthlyFee?: string;
  label?: string;
}

export const NO_BSP: BspFeeModel = { type: "NONE" };

export interface BspCostInput {
  metaCost: Decimal;
  messagesSent: number;
  billableMessages: number;
  months?: number;
}

export interface BspCostBreakdown {
  percentPart: Decimal;
  perMessagePart: Decimal;
  monthlyPart: Decimal;
  total: Decimal;
}

export function bspCost(model: BspFeeModel | null | undefined, input: BspCostInput): BspCostBreakdown {
  const zero = new Money(0);
  if (!model || model.type === "NONE") return { percentPart: zero, perMessagePart: zero, monthlyPart: zero, total: zero };
  const months = input.months ?? 1;
  const percentPart =
    model.type === "PERCENTAGE" || model.type === "MIXED" ? input.metaCost.times(money(model.percentOfMeta ?? 0)).dividedBy(100) : zero;
  const count = model.perMessageAppliesTo === "BILLABLE_ONLY" ? input.billableMessages : input.messagesSent;
  const perMessagePart =
    model.type === "FIXED_PER_MESSAGE" || model.type === "MIXED" ? money(model.perMessage ?? 0).times(count) : zero;
  const monthlyPart = model.type === "MONTHLY" || model.type === "MIXED" ? money(model.monthlyFee ?? 0).times(months) : zero;
  return { percentPart, perMessagePart, monthlyPart, total: percentPart.plus(perMessagePart).plus(monthlyPart) };
}

export interface BspComparisonInput {
  currency: string;
  metaMonthlyCost: string;
  monthlyMessages: number;
  billableMessages?: number;
  bsp: BspFeeModel;
  /** Extra monthly costs of going direct (hosting, SaaS like WCO, engineering). */
  directMonthlyExtra?: string;
  /** Extra monthly SaaS fees charged on top of the BSP. */
  bspMonthlyExtra?: string;
}

export interface BspComparisonResult {
  currency: string;
  direct: { monthly: string; annual: string };
  bsp: { monthly: string; annual: string; fees: { percent: string; perMessage: string; monthly: string } };
  difference: { monthly: string; annual: string; cheaper: "DIRECT" | "BSP" | "EQUAL" };
  notes: string[];
}

/** DIRECT CLOUD API vs BSP (spec §66). */
export function compareDirectVsBsp(input: BspComparisonInput): BspComparisonResult {
  const meta = money(input.metaMonthlyCost);
  const fees = bspCost(input.bsp, {
    metaCost: meta,
    messagesSent: input.monthlyMessages,
    billableMessages: input.billableMessages ?? input.monthlyMessages,
  });
  const direct = meta.plus(money(input.directMonthlyExtra ?? 0));
  const viaBsp = meta.plus(fees.total).plus(money(input.bspMonthlyExtra ?? 0));
  const diff = viaBsp.minus(direct);
  const f = (d: Decimal) => d.toDecimalPlaces(2).toFixed(2);
  return {
    currency: input.currency,
    direct: { monthly: f(direct), annual: f(direct.times(12)) },
    bsp: {
      monthly: f(viaBsp),
      annual: f(viaBsp.times(12)),
      fees: { percent: f(fees.percentPart), perMessage: f(fees.perMessagePart), monthly: f(fees.monthlyPart) },
    },
    difference: { monthly: f(diff.abs()), annual: f(diff.abs().times(12)), cheaper: diff.isZero() ? "EQUAL" : diff.isPositive() ? "DIRECT" : "BSP" },
    notes: [
      "A cobrança da Meta é idêntica nos dois cenários; a diferença está apenas nas taxas de terceiros e nos custos extras de operar diretamente.",
      "Nem todo BSP cobra markup — o resultado depende inteiramente do modelo de taxas informado.",
      "Resultado estimado, não é economia garantida.",
    ],
  };
}
