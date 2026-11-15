import { addHours, VerificationStatus, type ConversationContext } from "@wco/domain";
import type { PolicyDefinition, WindowEvaluation } from "./types";

/**
 * Recomputes the customer service window and the free entry point window AT A GIVEN INSTANT using the
 * window lengths of the policy in force (spec §5: "recalcular a janela de acordo com a regra vigente";
 * never trust only a local timer).
 *
 * FEP (S1): user messages via CTWA ad / Page CTA → business replies within 24h → the reply is free and
 * opens a 72h window starting at the reply. If Meta already reported the window expiry
 * (`conversation.expiration_timestamp`) that confirmed value wins over the local estimate.
 */
export function evaluateWindows(policy: PolicyDefinition, ctx: ConversationContext, at: Date): WindowEvaluation {
  const t = at.getTime();

  const lastInbound = ctx.customerServiceWindow.lastInboundAt;
  const cswExpires = lastInbound ? addHours(lastInbound, policy.customerServiceWindowHours) : null;
  const cswOpen = !!lastInbound && lastInbound.getTime() <= t && t < cswExpires!.getTime();

  const fep = ctx.freeEntryPoint;
  const rule = policy.freeEntryPoint;
  let fepOpen = false;
  let fepExpires: Date | null = null;
  let opensOnThisMessage = false;
  let eligibleForFreeReply = false;

  // A window CONFIRMED by Meta (status webhook pricing.type = free_entry_point) counts even when the entry point
  // type could not be detected locally (e.g. Facebook Page CTA messages carry no referral object).
  const typeOk = !!fep && (rule.entryPoints.includes(fep.type) || fep.verification === VerificationStatus.CONFIRMED);
  if (fep && typeOk && fep.verification !== VerificationStatus.REJECTED) {
    if (fep.windowStartedAt) {
      fepExpires = fep.confirmedExpiresAt ?? addHours(fep.windowStartedAt, rule.windowHours);
      if (!fep.confirmedExpiresAt && rule.extendOnInboundHours && lastInbound) {
        // UNVERIFIED candidate behaviour only: each inbound extends the window, capped.
        const extended = addHours(lastInbound, rule.extendOnInboundHours);
        const cap = addHours(fep.windowStartedAt, rule.maxWindowHours ?? rule.windowHours);
        if (extended > fepExpires) fepExpires = extended < cap ? extended : cap;
      }
      fepOpen = fep.windowStartedAt.getTime() <= t && t < fepExpires.getTime();
    } else {
      const replyDeadline = addHours(fep.userMessageAt, rule.replyWithinHours);
      eligibleForFreeReply = fep.userMessageAt.getTime() <= t && t < replyDeadline.getTime();
      if (eligibleForFreeReply) {
        opensOnThisMessage = true;
        fepOpen = true;
        fepExpires = addHours(at, rule.windowHours);
      }
    }
  }

  return {
    customerServiceWindow: { open: cswOpen, expiresAt: cswExpires },
    freeEntryPoint: {
      open: fepOpen,
      expiresAt: fepExpires,
      opensOnThisMessage,
      eligibleForFreeReply,
      verification: fep?.verification ?? null,
    },
  };
}

export interface WindowTimeLeft {
  /** Free-form (non-template) content can be sent now. */
  customerServiceWindowOpen: boolean;
  customerServiceWindowMs: number;
  freeEntryPointOpen: boolean;
  freeEntryPointMs: number;
}

/**
 * Time left in each window at `at`, minus a safety margin (Meta bills on DELIVERY time, so a message
 * sent in the last seconds of a window may be delivered after it closed). A window with less than
 * the margin left counts as closed.
 */
export function windowTimeLeft(w: WindowEvaluation, at: Date, safetyMarginSeconds = 0): WindowTimeLeft {
  const left = (open: boolean, expiresAt: Date | null) => (open && expiresAt ? Math.max(0, expiresAt.getTime() - at.getTime() - safetyMarginSeconds * 1000) : 0);
  const csw = left(w.customerServiceWindow.open, w.customerServiceWindow.expiresAt);
  const fep = left(w.freeEntryPoint.open, w.freeEntryPoint.expiresAt);
  return { customerServiceWindowOpen: csw > 0, customerServiceWindowMs: csw, freeEntryPointOpen: fep > 0, freeEntryPointMs: fep };
}

/** Whether the customer service window of (business number, customer) is open at `at` under `policy`. */
export function customerServiceWindowAt(policy: PolicyDefinition, ctx: ConversationContext, at: Date, safetyMarginSeconds = 0): { open: boolean; expiresAt: Date | null; remainingMs: number } {
  const w = evaluateWindows(policy, ctx, at);
  const t = windowTimeLeft(w, at, safetyMarginSeconds);
  return { open: t.customerServiceWindowOpen, expiresAt: w.customerServiceWindow.expiresAt, remainingMs: t.customerServiceWindowMs };
}
