import { BillingCategory, MessageKind, Priority } from "@wco/domain";
import { getFinOpsBridge, type FinOpsPrismaClientLike } from "@wco/optimization";
import type { CostDecision } from "@wco/pricing";
import type { AppContext } from "./context";

export type FinOpsGate =
  | {
      action: "SEND";
      templateName?: string;
      convertToFreeForm?: boolean;
      handoffUrl?: string;
      strategies?: string[];
    }
  | { action: "SUPPRESS"; reason: string; strategies: string[] }
  | { action: "DEFER"; until: Date; reason: string; strategies: string[] };

export interface FinOpsDispatchInput {
  tenantId: string;
  intentId: string;
  recipient: string;
  phoneNumberId: string;
  wabaId?: string;
  kind: MessageKind;
  category: BillingCategory;
  templateName: string | null;
  priority: string;
  deadlineAt: Date;
  mustSendImmediately: boolean;
  marketingOptedOut: boolean;
  estimate: CostDecision;
  serviceCost: number;
  now: Date;
  coveredIntentIds?: string[];
  tierPosition?: number;
  deferredPromoText?: string | null;
  flowId?: string | null;
  legacyBspMarkupUsd?: number;
}

const SEND: FinOpsGate = { action: "SEND" };
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

    if (input.kind !== MessageKind.TEMPLATE || !input.templateName) {
      const check = await bridge.cache.checkBeforeDispatch(input.recipient, "SERVICE", input.now);
      return check.blocked && check.action === "SUPPRESS"
        ? { action: "SUPPRESS", reason: check.entry?.reason ?? "global_suppression", strategies: ["M5_GLOBAL_CACHE_SUPPRESS"] }
        : SEND;
    }

    const variants = await bridge.repo.listMirrorVariants(input.tenantId);
    const own = variants.find((v) => v.metaTemplateName === input.templateName);
    const windows = input.estimate.eligibility.windows;
    const cost = Number(input.estimate.estimatedCost.toFixed(6));
    const covered = input.coveredIntentIds ?? [input.intentId];
    const bspMarkup = input.legacyBspMarkupUsd ?? Number(process.env.FINOPS_LEGACY_BSP_MARKUP_USD ?? 0);
    const externalBridgeUrl = process.env.FINOPS_EXTERNAL_BRIDGE_URL;

    const decision = await bridge.routeAndPersist(
      {
        intentId: input.intentId,
        tenantId: input.tenantId,
        recipientPhone: input.recipient,
        category,
        templateGroupKey: own?.groupKey,
        preferredTemplateName: input.templateName,
        renderedBodyText: input.templateName,
        deferredPromoOfferText: input.deferredPromoText ?? undefined,
        hasActive24hWindow: windows.customerServiceWindow.open,
        windowExpiresAt: windows.customerServiceWindow.expiresAt,
        hasActiveFep72hWindow: windows.freeEntryPoint.open,
        fepExpiresAt: windows.freeEntryPoint.expiresAt,
        allowMarketingToFreeForm: !input.marketingOptedOut,
        hasMarketingConsent: !input.marketingOptedOut,
        isCriticalOtp: false,
        routingTransport: externalBridgeUrl && category === "MARKETING" && !windows.customerServiceWindow.open ? "EXTERNAL_HTTP_BRIDGE" : "DIRECT_CLOUD_API",
        directRouteConfig: {
          phoneNumberId: input.phoneNumberId,
          accessToken: "",
          legacyBspMarkupPerMsgUsd: bspMarkup,
          graphApiVersion: ctx.config.env.META_GRAPH_API_VERSION || undefined,
        },
        externalBridgeConfig: externalBridgeUrl
          ? {
              endpointUrl: externalBridgeUrl,
              apiKey: process.env.FINOPS_EXTERNAL_BRIDGE_KEY,
              officialWabaPhone: process.env.FINOPS_OFFICIAL_WABA_PHONE ?? input.phoneNumberId,
              appendHandoffLink: true,
              unitCostUsd: 0,
            }
          : undefined,
        serviceUnitCostUsd: input.serviceCost,
        utilityUnitCostUsd: cost,
        marketingUnitCostUsd: cost,
        advanced: {
          unitUsd: cost > 0 ? cost : 0.0068,
          pendingBatch:
            covered.length > 1
              ? {
                  events: covered.map((id) => ({
                    intentId: id,
                    text: input.templateName ?? "",
                    category: category === "MARKETING" ? "MARKETING" : "UTILITY",
                  })),
                  templateName: input.templateName,
                  maxSlots: 5,
                }
              : undefined,
          wabaPools: [
            {
              wabaId: input.wabaId ?? "default",
              phoneId: input.phoneNumberId,
              vol: input.tierPosition ?? 0,
              tiers: [
                { min: 0, usd: cost > 0 ? cost : 0.0068 },
                { min: 10000, usd: Number(((cost > 0 ? cost : 0.0068) * 0.76).toFixed(6)) },
                { min: 100000, usd: Number(((cost > 0 ? cost : 0.0068) * 0.6).toFixed(6)) },
              ],
            },
          ],
          flowPlan: input.flowId
            ? {
                flowId: String(input.flowId),
                flowToken: input.intentId,
                stepsCount: Math.max(2, covered.length),
                has24hWindow: windows.customerServiceWindow.open,
                templateUsd: cost > 0 ? cost : 0.0068,
              }
            : undefined,
        },
      },
      input.now,
    );

    if (decision.status === "SUPPRESSED") {
      return { action: "SUPPRESS", reason: "INVALID_RECIPIENT_131026", strategies: decision.appliedStrategies };
    }
    if (decision.status === "DEFERRED") {
      const check = await bridge.cache.checkBeforeDispatch(input.recipient, category, input.now);
      const until = check.entry?.expiresAt ?? new Date(input.now.getTime() + 24 * 3_600_000);
      if (input.mustSendImmediately || until > input.deadlineAt) {
        return { action: "SEND", strategies: decision.appliedStrategies };
      }
      return {
        action: "DEFER",
        until: new Date(Math.min(until.getTime(), input.now.getTime() + MAX_DEFER_MS)),
        reason: "MARKETING_FREQUENCY_CAP_131049",
        strategies: decision.appliedStrategies,
      };
    }
    if (decision.deliveryMode === "CSW_24H_FREE_FORM") {
      return { action: "SEND", convertToFreeForm: true, strategies: decision.appliedStrategies };
    }
    if (decision.selectedTemplateName && decision.selectedTemplateName !== input.templateName) {
      return {
        action: "SEND",
        templateName: decision.selectedTemplateName,
        handoffUrl: decision.handoffUrl,
        strategies: decision.appliedStrategies,
      };
    }
    return { action: "SEND", handoffUrl: decision.handoffUrl, strategies: decision.appliedStrategies };
  } catch (e) {
    ctx.log.warn({ err: (e as Error).message, tenantId: input.tenantId }, "finops decision failed; dispatching without it");
    return SEND;
  }
}
