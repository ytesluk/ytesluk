import { BillingCategory, MessageKind, Priority } from "@wco/domain";
import {
  ExternalHttpBridgeProvider,
  getFinOpsBridge,
  type FinOpsPrismaClientLike,
  type FinOpsRoutingDecision,
  type WabaPool,
} from "@wco/optimization";
import type { CostDecision } from "@wco/pricing";
import type { AppContext } from "./context";

export type FinOpsGate =
  | {
      action: "SEND";
      transport?: "DIRECT_CLOUD_API" | "EXTERNAL_HTTP_BRIDGE";
      deliveryMode?: FinOpsRoutingDecision["deliveryMode"];
      templateName?: string;
      convertToFreeForm?: boolean;
      finalText?: string;
      quickReplyButton?: { id: string; title: string };
      deferredStep2Text?: string;
      handoffUrl?: string;
      externalMessageId?: string;
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
  language?: string;
  renderedBodyText?: string;
  priority: string;
  deadlineAt: Date;
  mustSendImmediately: boolean;
  marketingOptedOut: boolean;
  estimate: CostDecision;
  serviceCost: number;
  utilityCost?: number;
  marketingCost?: number;
  now: Date;
  coveredIntentIds?: string[];
  mergedTexts?: string[];
  tierPosition?: number;
  wabaPools?: WabaPool[];
  deferredPromoText?: string | null;
  flowId?: string | null;
  legacyBspMarkupUsd?: number;
  keepAliveEnabled?: boolean;
}

const SEND: FinOpsGate = { action: "SEND" };
const MAX_DEFER_MS = 72 * 3_600_000;
const DEFAULT_UTILITY_USD = 0.0068;

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

    const variants = await bridge.repo.listMirrorVariants(input.tenantId, undefined, input.language);
    const own = variants.find((v) => v.metaTemplateName === input.templateName);
    const windows = input.estimate.eligibility.windows;
    const cost = Number(input.estimate.estimatedCost.toFixed(6));
    const utilityUnitCostUsd =
      input.utilityCost ??
      (category === "UTILITY" ? cost : cost > DEFAULT_UTILITY_USD ? DEFAULT_UTILITY_USD : cost);
    const marketingUnitCostUsd = input.marketingCost ?? cost;

    const covered = input.coveredIntentIds ?? [input.intentId];
    const bodyText = input.renderedBodyText ?? input.templateName;
    const bspMarkup = input.legacyBspMarkupUsd ?? Number(process.env.FINOPS_LEGACY_BSP_MARKUP_USD ?? 0);
    const externalBridgeUrl = process.env.FINOPS_EXTERNAL_BRIDGE_URL;
    const externalBridgeConfig = externalBridgeUrl
      ? {
          endpointUrl: externalBridgeUrl,
          apiKey: process.env.FINOPS_EXTERNAL_BRIDGE_KEY,
          officialWabaPhone: process.env.FINOPS_OFFICIAL_WABA_PHONE ?? input.phoneNumberId,
          appendHandoffLink: true,
          unitCostUsd: 0,
        }
      : undefined;

    const decision = await bridge.routeAndPersist(
      {
        intentId: input.intentId,
        tenantId: input.tenantId,
        recipientPhone: input.recipient,
        category,
        language: input.language,
        templateGroupKey: own?.groupKey,
        preferredTemplateName: input.templateName,
        renderedBodyText: bodyText,
        deferredPromoOfferText: input.deferredPromoText ?? undefined,
        hasActive24hWindow: windows.customerServiceWindow.open,
        windowExpiresAt: windows.customerServiceWindow.expiresAt,
        hasActiveFep72hWindow: windows.freeEntryPoint.open,
        fepExpiresAt: windows.freeEntryPoint.expiresAt,
        keepAliveEnabled: input.keepAliveEnabled ?? false,
        allowMarketingToFreeForm: !input.marketingOptedOut,
        hasMarketingConsent: !input.marketingOptedOut,
        isCriticalOtp: false,
        routingTransport:
          externalBridgeConfig && category === "MARKETING" && !windows.customerServiceWindow.open
            ? "EXTERNAL_HTTP_BRIDGE"
            : "DIRECT_CLOUD_API",
        directRouteConfig: {
          phoneNumberId: input.phoneNumberId,
          accessToken: "",
          legacyBspMarkupPerMsgUsd: bspMarkup,
          graphApiVersion: ctx.config.env.META_GRAPH_API_VERSION || undefined,
        },
        externalBridgeConfig,
        serviceUnitCostUsd: input.serviceCost,
        utilityUnitCostUsd,
        marketingUnitCostUsd,
        advanced: {
          unitUsd: utilityUnitCostUsd > 0 ? utilityUnitCostUsd : DEFAULT_UTILITY_USD,
          pendingBatch:
            input.mergedTexts && input.mergedTexts.length > 1
              ? {
                  events: input.mergedTexts.map((text, idx) => ({
                    intentId: covered[idx] ?? `${input.intentId}_${idx}`,
                    text,
                    category: category === "MARKETING" ? "MARKETING" : "UTILITY",
                  })),
                  templateName: input.templateName,
                  maxSlots: 5,
                }
              : undefined,
          wabaPools: input.wabaPools,
          flowPlan: input.flowId
            ? {
                flowId: String(input.flowId),
                flowToken: input.intentId,
                stepsCount: Math.max(2, covered.length),
                has24hWindow: windows.customerServiceWindow.open,
                templateUsd: utilityUnitCostUsd > 0 ? utilityUnitCostUsd : DEFAULT_UTILITY_USD,
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

    if (decision.transport === "EXTERNAL_HTTP_BRIDGE" && externalBridgeConfig) {
      const bridgeProvider = new ExternalHttpBridgeProvider(externalBridgeConfig);
      const sent = await bridgeProvider.send({
        intentId: input.intentId,
        tenantId: input.tenantId,
        to: input.recipient,
        text: bodyText,
      });

      if (sent.ok) {
        return {
          action: "SEND",
          transport: "EXTERNAL_HTTP_BRIDGE",
          deliveryMode: decision.deliveryMode,
          finalText: sent.finalRenderedText,
          handoffUrl: sent.handoffUrl,
          externalMessageId: sent.providerMessageId,
          strategies: decision.appliedStrategies,
        };
      }

      ctx.log.warn(
        { err: sent.errorMessage, intentId: input.intentId },
        "external http bridge failed; falling back to direct cloud api",
      );
    }

    if (decision.deliveryMode === "CSW_24H_FREE_FORM") {
      return {
        action: "SEND",
        transport: "DIRECT_CLOUD_API",
        deliveryMode: decision.deliveryMode,
        convertToFreeForm: true,
        finalText: decision.finalText,
        strategies: decision.appliedStrategies,
      };
    }

    return {
      action: "SEND",
      transport: "DIRECT_CLOUD_API",
      deliveryMode: decision.deliveryMode,
      templateName:
        decision.selectedTemplateName && decision.selectedTemplateName !== input.templateName
          ? decision.selectedTemplateName
          : undefined,
      finalText: decision.finalText,
      quickReplyButton: decision.quickReplyButton,
      deferredStep2Text: decision.deferredStep2Text,
      handoffUrl: decision.handoffUrl,
      strategies: decision.appliedStrategies,
    };
  } catch (e) {
    ctx.log.warn({ err: (e as Error).message, tenantId: input.tenantId }, "finops decision failed; dispatching without it");
    return SEND;
  }
}
