import { BillingCategory, MessageKind, Priority } from "@wco/domain";
import { getFinOpsBridge, type FinOpsPrismaClientLike } from "@wco/optimization";
import type { CostDecision } from "@wco/pricing";
import type { AppContext } from "./context";

/**
 * Connects the FinOps module (packages/optimization/src/finops) to the dispatch path. The module's
 * own code is used as it is; this file only feeds it what the dispatcher knows and turns its
 * answer into what the dispatcher does.
 *
 * What the FinOps decision changes here:
 * - Global deliverability cache (module 5): a recipient Meta answered 131026 for is not attempted
 *   until the suppression expires; a marketing template to a recipient Meta answered 131049 for
 *   waits until it expires, when the message can wait that long. A message the client marked to go
 *   immediately, or whose deadline comes first, is still attempted (as the planner already decided:
 *   Meta has the last word, and a delivery ends the per-tenant cooldown).
 * - Template mirror pool (module 2B): when the template is registered in a mirror group and the
 *   pool picks another approved UTILITY variant (e.g. Meta reclassified this one as MARKETING),
 *   that variant is sent instead.
 * - Every template send is written to the FinOps savings ledger, and the module's monthly
 *   service quota counter is kept.
 *
 * What it does not change, on purpose:
 * - Message format and windows: the pricing engine already sends a template as a free-form or
 *   interactive message inside the customer service window and uses free entry point windows, so
 *   the costs given to the module are what this exact send costs. Its window modules then find no
 *   further saving, and the ledger never claims one the send did not get.
 * - Transport: always the official Cloud API (`DIRECT_CLOUD_API`). The external HTTP bridge
 *   (module 6) would send outside the official API, which the product promises never to do.
 * - BSP markup (module 4): the WCO calls the Cloud API directly; with no previous BSP configured
 *   there is no avoided fee to report, so it is 0.
 * - Critical and authentication messages skip FinOps entirely: a stale suppression must never hold
 *   back a verification code.
 * - Message content is not given to the module (it does not need it and the ledger stores none).
 *
 * Costs are in the rate card's currency (the module's ledger columns say USD; with a BRL rate card
 * the values are BRL). If the module fails, sending goes on as without it.
 *
 * `FINOPS_ENABLED=false` turns the integration off; `FINOPS_GLOBAL_SALT` keys the recipient hash
 * shared across tenants (set it in production).
 */
export type FinOpsGate =
  | { action: "SEND"; templateName?: string; strategies?: string[] }
  | { action: "SUPPRESS"; reason: string; strategies: string[] }
  | { action: "DEFER"; until: Date; reason: string; strategies: string[] };

export interface FinOpsDispatchInput {
  tenantId: string;
  intentId: string;
  recipient: string;
  /** The business phone's Meta id. */
  phoneNumberId: string;
  kind: MessageKind;
  category: BillingCategory;
  templateName: string | null;
  priority: string;
  deadlineAt: Date;
  mustSendImmediately: boolean;
  marketingOptedOut: boolean;
  /** Cost of this exact send, as the pricing engine estimates it. */
  estimate: CostDecision;
  /** Cost of a free-form service message to this recipient now. */
  serviceCost: number;
  now: Date;
}

const SEND: FinOpsGate = { action: "SEND" };
/** Longest a job is parked waiting for a marketing cap to expire (the module's own maximum is 72 h). */
const MAX_DEFER_MS = 72 * 3_600_000;

export function finopsEnabled(): boolean {
  return process.env.FINOPS_ENABLED !== "false";
}

function finopsCategory(c: BillingCategory): "MARKETING" | "UTILITY" | "AUTHENTICATION" {
  if (c === BillingCategory.MARKETING || c === BillingCategory.MARKETING_LITE) return "MARKETING";
  if (c === BillingCategory.AUTHENTICATION || c === BillingCategory.AUTHENTICATION_INTERNATIONAL) return "AUTHENTICATION";
  return "UTILITY";
}

export async function finopsBeforeDispatch(ctx: AppContext, input: FinOpsDispatchInput): Promise<FinOpsGate> {
  if (!finopsEnabled()) return SEND;
  const category = finopsCategory(input.category);
  if (input.priority === Priority.CRITICAL || category === "AUTHENTICATION") return SEND;

  try {
    const bridge = getFinOpsBridge(ctx.db as unknown as FinOpsPrismaClientLike);

    // Free-form messages: only the global cache applies (nothing to price or swap).
    if (input.kind !== MessageKind.TEMPLATE || !input.templateName) {
      const check = await bridge.cache.checkBeforeDispatch(input.recipient, "SERVICE", input.now);
      return check.blocked && check.action === "SUPPRESS" ? { action: "SUPPRESS", reason: check.entry?.reason ?? "global_suppression", strategies: ["M5_GLOBAL_CACHE_SUPPRESS"] } : SEND;
    }

    const variants = await bridge.repo.listMirrorVariants(input.tenantId);
    const own = variants.find((v) => v.metaTemplateName === input.templateName);
    const windows = input.estimate.eligibility.windows;
    const cost = Number(input.estimate.estimatedCost.toFixed(6));

    const decision = await bridge.routeAndPersist(
      {
        intentId: input.intentId,
        tenantId: input.tenantId,
        recipientPhone: input.recipient,
        category,
        templateGroupKey: own?.groupKey,
        preferredTemplateName: input.templateName,
        renderedBodyText: "",
        hasActive24hWindow: windows.customerServiceWindow.open,
        windowExpiresAt: windows.customerServiceWindow.expiresAt,
        hasActiveFep72hWindow: windows.freeEntryPoint.open,
        fepExpiresAt: windows.freeEntryPoint.expiresAt,
        allowMarketingToFreeForm: false,
        hasMarketingConsent: !input.marketingOptedOut,
        isCriticalOtp: false,
        routingTransport: "DIRECT_CLOUD_API",
        directRouteConfig: { phoneNumberId: input.phoneNumberId, accessToken: "", legacyBspMarkupPerMsgUsd: 0, graphApiVersion: ctx.config.env.META_GRAPH_API_VERSION || undefined },
        serviceUnitCostUsd: input.serviceCost,
        utilityUnitCostUsd: cost,
        marketingUnitCostUsd: cost,
      },
      input.now,
    );

    if (decision.status === "SUPPRESSED") return { action: "SUPPRESS", reason: "INVALID_RECIPIENT_131026", strategies: decision.appliedStrategies };
    if (decision.status === "DEFERRED") {
      const check = await bridge.cache.checkBeforeDispatch(input.recipient, category, input.now);
      const until = check.entry?.expiresAt ?? new Date(input.now.getTime() + 24 * 3_600_000);
      if (input.mustSendImmediately || until > input.deadlineAt) return { action: "SEND", strategies: decision.appliedStrategies };
      return { action: "DEFER", until: new Date(Math.min(until.getTime(), input.now.getTime() + MAX_DEFER_MS)), reason: "MARKETING_FREQUENCY_CAP_131049", strategies: decision.appliedStrategies };
    }
    if (decision.selectedTemplateName && decision.selectedTemplateName !== input.templateName) {
      return { action: "SEND", templateName: decision.selectedTemplateName, strategies: decision.appliedStrategies };
    }
    return SEND;
  } catch (e) {
    ctx.log.warn({ err: (e as Error).message, tenantId: input.tenantId }, "finops decision failed; dispatching without it");
    return SEND;
  }
}
