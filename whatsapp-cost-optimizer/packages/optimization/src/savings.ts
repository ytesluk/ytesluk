import { Confidence, MessageStatus, Money, RoutingReason, SavingsKind, money, type Decimal, type SavingsMechanism } from "@wco/domain";
import { bspFeePerMessage, type BspFeeModel } from "@wco/pricing";

/**
 * Savings attribution per intent (spec §13, §14, §106). Three SEPARATE kinds — never merged:
 *   META            — Meta charges avoided (messages avoided, free windows/quota used, cheaper allowed kind)
 *   BSP             — third-party fees avoided (only when the tenant actually uses a BSP)
 *   INFRASTRUCTURE  — WCO/client infrastructure work avoided (provider calls not made)
 *
 * A legacy BSP (the one the tenant used before connecting directly through the WCO) adds a BSP line
 * per message, BSP_MARKUP_AVOIDED: the fee that BSP would have charged on top of the same Meta cost.
 * Messages not attempted because of what Meta reported about the recipient (131026 / 131049) only
 * ever produce an INFRASTRUCTURE line — an undelivered message is not billed, so there is no Meta saving.
 *
 * The baseline (what the message would cost without WCO) is always a counterfactual → ESTIMATED.
 * "Realized" savings use the realized cost of the optimized side (delivery webhooks); if the
 * realized side is not known yet, the record stays ESTIMATED. Unknown pricing → no savings claimed.
 */
export type SavingsMechanismName = SavingsMechanism;

/**
 * Which routing feature explains a lower cost, from the decision's reason codes (the same codes
 * stored in MessageIntent.decisionReason). Null when none of them applies.
 */
export function mechanismFromReasons(reasons: string[] | string | null | undefined): SavingsMechanismName | null {
  const list = Array.isArray(reasons) ? reasons : (reasons ?? "").split(",");
  const has = (r: string) => list.includes(r);
  if (has(RoutingReason.UTILITY_SPLIT_DEFERRED)) return "UTILITY_SPLIT_DEFERRED";
  if (has(RoutingReason.TEMPLATE_TO_FREEFORM_CSW) || has(RoutingReason.INBOUND_FIRST_CONVERTED)) return "TEMPLATE_TO_FREEFORM_CSW";
  if (has("free_form_service_message_cheaper_inside_window")) return "CATEGORY";
  if (has(RoutingReason.FEP_PRIORITY)) return "FEP_PRIORITY";
  return null;
}

export interface SavingsInput {
  status: MessageStatus;
  /** Counterfactual cost without WCO (null when UNKNOWN). */
  baselineCost: Decimal | null;
  /** Optimized cost: estimated (decision) or realized (webhook). Null when UNKNOWN/not yet known. */
  optimizedCost: Decimal | null;
  optimizedConfidence: Confidence;
  freeReason?: string | null;
  switchedToFreeForm?: boolean;
  /** Routing feature behind the decision (see mechanismFromReasons). */
  mechanismHint?: SavingsMechanismName | null;
  usesBsp: boolean;
  bspModel?: BspFeeModel | null;
  /** Fee model of the BSP the tenant used before going direct (ignored while `usesBsp`). */
  legacyBspModel?: BspFeeModel | null;
  /** Not attempted: Meta recently reported the recipient as undeliverable (131026). */
  suppressedInvalidRecipient?: boolean;
  /** Held back while Meta's per-user marketing limit (131049) cools down. */
  deferredFrequencyCap?: boolean;
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
  const infra = input.infraCostPerProviderCall;
  const infraLine = (mechanism: SavingsMechanismName): SavingsLine => ({ kind: SavingsKind.INFRASTRUCTURE, mechanism, baselineCost: infra, optimizedCost: zero, savings: infra, confidence: Confidence.ESTIMATED });

  // A call that would have failed is avoided. No Meta line: Meta does not bill undelivered messages.
  if (input.suppressedInvalidRecipient) return infra.gt(0) ? [infraLine("INVALID_RECIPIENT_SUPPRESSED")] : [];
  if (input.deferredFrequencyCap && infra.gt(0)) lines.push(infraLine("FREQUENCY_CAP_DEFERRED"));

  if (input.baselineCost === null) return lines; // never claim savings without a known baseline
  const avoided = AVOIDED[input.status];
  const baseline = input.baselineCost;
  // Fee on top of the Meta cost of the message as it would have gone WITHOUT the WCO.
  const legacy = !input.usesBsp && input.legacyBspModel ? bspFeePerMessage(input.legacyBspModel, baseline) : zero;
  const bspLine = (fee: Decimal, mechanism: SavingsMechanismName): SavingsLine => ({ kind: SavingsKind.BSP, mechanism, baselineCost: fee, optimizedCost: zero, savings: fee, confidence: Confidence.ESTIMATED });

  if (avoided) {
    lines.push({ kind: SavingsKind.META, mechanism: avoided, baselineCost: baseline, optimizedCost: zero, savings: baseline, confidence: Confidence.ESTIMATED });
    if (input.usesBsp && input.bspModel) {
      const perMessage = bspFeePerMessage(input.bspModel, baseline);
      if (perMessage.isPositive()) lines.push(bspLine(perMessage, "BSP_MARKUP"));
    } else if (legacy.gt(0)) {
      lines.push(bspLine(legacy, "BSP_MARKUP_AVOIDED"));
    }
    if (infra.isPositive()) lines.push(infraLine("INFRASTRUCTURE"));
    return lines;
  }

  if (input.optimizedCost === null) return lines;
  // The message went out directly through the Cloud API: the legacy BSP's fee was not paid.
  if (legacy.gt(0)) lines.push(bspLine(legacy, "BSP_MARKUP_AVOIDED"));
  const diff = baseline.minus(input.optimizedCost);
  if (diff.isZero()) return lines;
  const byWindow: SavingsMechanismName = input.freeReason === "free_monthly_quota" ? "FREE_QUOTA" : input.freeReason ? "FREE_WINDOW" : "NONE";
  const hint = input.mechanismHint ?? (input.switchedToFreeForm ? "CATEGORY" : null);
  // FEP priority only explains the saving when the message really went free inside the entry point window.
  const mechanism: SavingsMechanismName = hint === "FEP_PRIORITY" ? (input.freeReason === "free_entry_point_window" ? "FEP_PRIORITY" : byWindow) : (hint ?? byWindow);
  // Realized only when the optimized side is confirmed by Meta webhooks; the baseline stays a counterfactual.
  const confidence = input.optimizedConfidence === Confidence.REALIZED || input.optimizedConfidence === Confidence.RECONCILED ? Confidence.REALIZED : Confidence.ESTIMATED;
  lines.push({ kind: SavingsKind.META, mechanism, baselineCost: baseline, optimizedCost: input.optimizedCost, savings: diff, confidence });
  return lines;
}

export function sumLines(lines: SavingsLine[], kind: SavingsKind): Decimal {
  return lines.filter((l) => l.kind === kind).reduce((acc, l) => acc.plus(l.savings), money(0));
}
