import { Confidence, MessageStatus, Money, SavingsKind, money, type Decimal } from "@wco/domain";
import { bspCost, type BspFeeModel } from "@wco/pricing";

/**
 * Savings attribution per intent (spec §13, §14, §106). Three SEPARATE kinds — never merged:
 *   META            — Meta charges avoided (messages avoided, free windows/quota used, cheaper allowed kind)
 *   BSP             — third-party fees avoided (only when the tenant actually uses a BSP)
 *   INFRASTRUCTURE  — WCO/client infrastructure work avoided (provider calls not made)
 *
 * The baseline (what the message would cost without WCO) is always a counterfactual → ESTIMATED.
 * "Realized" savings use the realized cost of the optimized side (delivery webhooks); if the
 * realized side is not known yet, the record stays ESTIMATED. Unknown pricing → no savings claimed.
 */
export type SavingsMechanismName =
  | "DEDUPLICATION"
  | "SUPERSESSION"
  | "CONSOLIDATION"
  | "FREE_WINDOW"
  | "FREE_QUOTA"
  | "CATEGORY"
  | "BSP_MARKUP"
  | "INFRASTRUCTURE"
  | "NONE";

export interface SavingsInput {
  status: MessageStatus;
  /** Counterfactual cost without WCO (null when UNKNOWN). */
  baselineCost: Decimal | null;
  /** Optimized cost: estimated (decision) or realized (webhook). Null when UNKNOWN/not yet known. */
  optimizedCost: Decimal | null;
  optimizedConfidence: Confidence;
  freeReason?: string | null;
  switchedToFreeForm?: boolean;
  usesBsp: boolean;
  bspModel?: BspFeeModel | null;
  infraCostPerProviderCall: Decimal;
}

export interface SavingsLine {
  kind: SavingsKind;
  mechanism: SavingsMechanismName;
  baselineCost: Decimal;
  optimizedCost: Decimal;
  savings: Decimal;
  confidence: Confidence;
}

const AVOIDED: Partial<Record<MessageStatus, SavingsMechanismName>> = {
  DEDUPLICATED: "DEDUPLICATION",
  SUPERSEDED: "SUPERSESSION",
  CONSOLIDATED: "CONSOLIDATION",
};

export function attributeSavings(input: SavingsInput): SavingsLine[] {
  const zero: Decimal = new Money(0);
  const lines: SavingsLine[] = [];
  if (input.baselineCost === null) return lines; // never claim savings without a known baseline
  const avoided = AVOIDED[input.status];
  const baseline = input.baselineCost;

  if (avoided) {
    lines.push({ kind: SavingsKind.META, mechanism: avoided, baselineCost: baseline, optimizedCost: zero, savings: baseline, confidence: Confidence.ESTIMATED });
    if (input.usesBsp && input.bspModel) {
      const fee = bspCost(input.bspModel, { metaCost: baseline, messagesSent: 1, billableMessages: baseline.isPositive() ? 1 : 0 });
      const perMessage = fee.percentPart.plus(fee.perMessagePart);
      if (perMessage.isPositive()) {
        lines.push({ kind: SavingsKind.BSP, mechanism: "BSP_MARKUP", baselineCost: perMessage, optimizedCost: zero, savings: perMessage, confidence: Confidence.ESTIMATED });
      }
    }
    if (input.infraCostPerProviderCall.isPositive()) {
      lines.push({
        kind: SavingsKind.INFRASTRUCTURE,
        mechanism: "INFRASTRUCTURE",
        baselineCost: input.infraCostPerProviderCall,
        optimizedCost: zero,
        savings: input.infraCostPerProviderCall,
        confidence: Confidence.ESTIMATED,
      });
    }
    return lines;
  }

  if (input.optimizedCost === null) return lines;
  const diff = baseline.minus(input.optimizedCost);
  if (diff.isZero()) return lines;
  const mechanism: SavingsMechanismName = input.switchedToFreeForm
    ? "CATEGORY"
    : input.freeReason === "free_monthly_quota"
      ? "FREE_QUOTA"
      : input.freeReason
        ? "FREE_WINDOW"
        : "NONE";
  // Realized only when the optimized side is confirmed by Meta webhooks; the baseline stays a counterfactual.
  const confidence = input.optimizedConfidence === Confidence.REALIZED || input.optimizedConfidence === Confidence.RECONCILED ? Confidence.REALIZED : Confidence.ESTIMATED;
  lines.push({ kind: SavingsKind.META, mechanism, baselineCost: baseline, optimizedCost: input.optimizedCost, savings: diff, confidence });
  return lines;
}

export function sumLines(lines: SavingsLine[], kind: SavingsKind): Decimal {
  return lines.filter((l) => l.kind === kind).reduce((acc, l) => acc.plus(l.savings), money(0));
}
