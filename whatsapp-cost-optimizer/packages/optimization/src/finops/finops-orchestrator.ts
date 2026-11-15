import {
  evaluateCswSubstitution,
  type InteractiveButtonSpec,
} from './csw-substitution';
import {
  splitTwoStepCampaign,
  TemplateMirrorPool,
  type MirrorTemplateVariant,
} from './two-step-and-mirror-pool';
import { evaluateFepAndKeepAlive } from './fep-and-keep-alive';
import { DirectCloudApiRouter, type DirectRouteConfig } from './bsp-bypass-mirror';
import { GlobalDeliverabilityCache } from './global-deliverability-cache';
import {
  ExternalHttpBridgeProvider,
  type ExternalBridgeConfig,
} from './external-http-bridge';

export interface FinOpsDispatchContext {
  intentId: string;
  tenantId: string;
  recipientPhone: string;
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  templateGroupKey?: string;
  preferredTemplateName?: string;
  mirrorVariants?: MirrorTemplateVariant[];
  renderedBodyText: string;
  deferredPromoOfferText?: string;
  buttons?: InteractiveButtonSpec[];
  hasActive24hWindow: boolean;
  windowExpiresAt?: Date | null;
  hasActiveFep72hWindow: boolean;
  fepExpiresAt?: Date | null;
  allowMarketingToFreeForm: boolean;
  hasMarketingConsent: boolean;
  isCriticalOtp?: boolean;
  routingTransport: 'DIRECT_CLOUD_API' | 'EXTERNAL_HTTP_BRIDGE';
  directRouteConfig: DirectRouteConfig;
  externalBridgeConfig?: ExternalBridgeConfig;
  monthlyFreeServiceQuotaUsed: number;
  serviceUnitCostUsd: number;
  utilityUnitCostUsd: number;
  marketingUnitCostUsd: number;
}

export interface FinOpsRoutingDecision {
  status: 'DISPATCH' | 'SUPPRESSED' | 'DEFERRED';
  transport: 'DIRECT_CLOUD_API' | 'EXTERNAL_HTTP_BRIDGE' | 'NONE';
  deliveryMode:
    | 'FEP_72H_FREE'
    | 'CSW_24H_FREE_FORM'
    | 'TWO_STEP_UTILITY_HOOK'
    | 'MIRROR_UTILITY_TEMPLATE'
    | 'EXTERNAL_BRIDGE_WITH_HANDOFF'
    | 'STANDARD_TEMPLATE'
    | 'BLOCKED';
  selectedTemplateName?: string;
  handoffUrl?: string;
  finalText: string;
  baselineTotalCostUsd: number;
  finalTotalCostUsd: number;
  metaTariffSavingsUsd: number;
  avoidedBspFeeUsd: number;
  totalSavingsUsd: number;
  appliedStrategies: string[];
}

export class FinOpsCostOrchestrator {
  private readonly mirrorPool = new TemplateMirrorPool();
  private readonly directRouter = new DirectCloudApiRouter();

  constructor(private readonly deliverabilityCache: GlobalDeliverabilityCache) {}

  public async evaluateAndRoute(
    ctx: FinOpsDispatchContext,
    now = new Date(),
  ): Promise<FinOpsRoutingDecision> {
    const appliedStrategies: string[] = [];
    const baseMetaCost =
      ctx.category === 'MARKETING' ? ctx.marketingUnitCostUsd : ctx.utilityUnitCostUsd;
    const directInfo = this.directRouter.buildDirectRequest(ctx.directRouteConfig);
    const avoidedBspFeeUsd = directInfo.avoidedBspFeeUsd;
    const baselineTotalCostUsd = Number((baseMetaCost + avoidedBspFeeUsd).toFixed(6));

    if (avoidedBspFeeUsd > 0) {
      appliedStrategies.push('M4_DIRECT_CLOUD_API_BSP_BYPASS');
    }

    // Módulo 5: Cache Global de Entregabilidade (131026 / 131049)
    const cacheCheck = await this.deliverabilityCache.checkBeforeDispatch(
      ctx.recipientPhone,
      ctx.category,
      now,
    );
    if (cacheCheck.blocked) {
      appliedStrategies.push(`M5_GLOBAL_CACHE_${cacheCheck.action}`);
      return {
        status: cacheCheck.action === 'SUPPRESS' ? 'SUPPRESSED' : 'DEFERRED',
        transport: 'NONE',
        deliveryMode: 'BLOCKED',
        finalText: ctx.renderedBodyText,
        baselineTotalCostUsd,
        finalTotalCostUsd: 0,
        metaTariffSavingsUsd: baseMetaCost,
        avoidedBspFeeUsd,
        totalSavingsUsd: baselineTotalCostUsd,
        appliedStrategies,
      };
    }

    // Módulo 3: Janela Gratuita FEP 72h
    const fepDecision = evaluateFepAndKeepAlive(
      {
        hasActiveFep72hWindow: ctx.hasActiveFep72hWindow,
        fepExpiresAt: ctx.fepExpiresAt,
        hasActiveCsw24hWindow: ctx.hasActive24hWindow,
        cswExpiresAt: ctx.windowExpiresAt,
        upcomingCategory: ctx.category === 'MARKETING' ? 'MARKETING' : 'UTILITY',
        upcomingTemplateCostUsd: baseMetaCost,
        keepAliveEnabled: false,
        triggerBeforeExpiryMinutes: 45,
        estimatedReplyRate: 0.35,
        monthlyFreeServiceQuotaUsed: ctx.monthlyFreeServiceQuotaUsed,
        serviceUnitCostUsd: ctx.serviceUnitCostUsd,
      },
      now,
    );

    if (fepDecision.action === 'PULL_FORWARD_INTO_FEP_72H') {
      appliedStrategies.push('M3_FEP_72H_FREE_WINDOW');
      return {
        status: 'DISPATCH',
        transport: 'DIRECT_CLOUD_API',
        deliveryMode: 'FEP_72H_FREE',
        finalText: ctx.renderedBodyText,
        baselineTotalCostUsd,
        finalTotalCostUsd: 0,
        metaTariffSavingsUsd: baseMetaCost,
        avoidedBspFeeUsd,
        totalSavingsUsd: baselineTotalCostUsd,
        appliedStrategies,
      };
    }

    // Módulo 1: Substituição por Mensagem Livre na Janela de 24h
    const cswDecision = evaluateCswSubstitution(
      {
        hasActive24hWindow: ctx.hasActive24hWindow,
        windowExpiresAt: ctx.windowExpiresAt,
        templateCategory: ctx.category,
        templateCostUsd: baseMetaCost,
        renderedBodyText: ctx.renderedBodyText,
        buttons: ctx.buttons,
        allowMarketingToFreeForm: ctx.allowMarketingToFreeForm,
        hasMarketingConsent: ctx.hasMarketingConsent,
        isCriticalOtp: ctx.isCriticalOtp,
        monthlyFreeServiceQuotaUsed: ctx.monthlyFreeServiceQuotaUsed,
        serviceUnitCostUsd: ctx.serviceUnitCostUsd,
      },
      now,
    );

    if (cswDecision.substituted) {
      appliedStrategies.push('M1_CSW_24H_FREE_FORM_SUBSTITUTION');
      return {
        status: 'DISPATCH',
        transport: 'DIRECT_CLOUD_API',
        deliveryMode: 'CSW_24H_FREE_FORM',
        finalText: ctx.renderedBodyText,
        baselineTotalCostUsd,
        finalTotalCostUsd: cswDecision.effectiveCostUsd,
        metaTariffSavingsUsd: cswDecision.savingsUsd,
        avoidedBspFeeUsd,
        totalSavingsUsd: Number((cswDecision.savingsUsd + avoidedBspFeeUsd).toFixed(6)),
        appliedStrategies,
      };
    }

    // Módulo 6: Roteador Multi-Transporte + Handoff wa.me (quando configurado para aquisição fria)
    if (
      ctx.routingTransport === 'EXTERNAL_HTTP_BRIDGE' &&
      ctx.externalBridgeConfig &&
      ctx.category === 'MARKETING' &&
      !ctx.hasActive24hWindow
    ) {
      const bridge = new ExternalHttpBridgeProvider(ctx.externalBridgeConfig);
      const prepared = bridge.prepareDispatch({
        intentId: ctx.intentId,
        tenantId: ctx.tenantId,
        to: ctx.recipientPhone,
        text: ctx.renderedBodyText,
      });
      appliedStrategies.push('M6_EXTERNAL_BRIDGE_WITH_OFFICIAL_HANDOFF');
      const metaSavings = Number(Math.max(0, baseMetaCost - prepared.effectiveCostUsd).toFixed(6));
      return {
        status: 'DISPATCH',
        transport: 'EXTERNAL_HTTP_BRIDGE',
        deliveryMode: 'EXTERNAL_BRIDGE_WITH_HANDOFF',
        handoffUrl: prepared.handoffUrl,
        finalText: prepared.finalRenderedText,
        baselineTotalCostUsd,
        finalTotalCostUsd: prepared.effectiveCostUsd,
        metaTariffSavingsUsd: metaSavings,
        avoidedBspFeeUsd,
        totalSavingsUsd: Number((metaSavings + avoidedBspFeeUsd).toFixed(6)),
        appliedStrategies,
      };
    }

    // Módulo 2B: Pool de Templates-Espelho (Failover UTILITY)
    let selectedTemplateName = ctx.preferredTemplateName;
    if (ctx.mirrorVariants && ctx.mirrorVariants.length > 0) {
      const mirrorSelection = this.mirrorPool.selectHealthyUtilityVariant(
        ctx.mirrorVariants,
        ctx.preferredTemplateName,
      );
      if (mirrorSelection.selected) {
        selectedTemplateName = mirrorSelection.selected.metaTemplateName;
        appliedStrategies.push(`M2_MIRROR_POOL_${mirrorSelection.reason}`);
      }
    }

    // Módulo 2A: Split em Duas Etapas (Aviso Utility + Oferta Diferida)
    if (ctx.deferredPromoOfferText && ctx.category === 'MARKETING') {
      const freeFormCost =
        ctx.monthlyFreeServiceQuotaUsed < 1000 ? 0 : ctx.serviceUnitCostUsd;
      const split = splitTwoStepCampaign({
        utilityNoticeText: ctx.renderedBodyText,
        promotionalOfferText: ctx.deferredPromoOfferText,
        marketingRateUsd: ctx.marketingUnitCostUsd,
        utilityRateUsd: ctx.utilityUnitCostUsd,
        freeFormExpectedRateUsd: freeFormCost,
      });

      if (split.splitApplied) {
        appliedStrategies.push('M2_TWO_STEP_UTILITY_HOOK');
        return {
          status: 'DISPATCH',
          transport: 'DIRECT_CLOUD_API',
          deliveryMode: 'TWO_STEP_UTILITY_HOOK',
          selectedTemplateName,
          finalText: split.step1UtilityText,
          baselineTotalCostUsd,
          finalTotalCostUsd: ctx.utilityUnitCostUsd,
          metaTariffSavingsUsd: split.estimatedSavingsUsd,
          avoidedBspFeeUsd,
          totalSavingsUsd: Number((split.estimatedSavingsUsd + avoidedBspFeeUsd).toFixed(6)),
          appliedStrategies,
        };
      }
    }

    return {
      status: 'DISPATCH',
      transport: 'DIRECT_CLOUD_API',
      deliveryMode: selectedTemplateName ? 'MIRROR_UTILITY_TEMPLATE' : 'STANDARD_TEMPLATE',
      selectedTemplateName,
      finalText: ctx.renderedBodyText,
      baselineTotalCostUsd,
      finalTotalCostUsd: baseMetaCost,
      metaTariffSavingsUsd: 0,
      avoidedBspFeeUsd,
      totalSavingsUsd: avoidedBspFeeUsd,
      appliedStrategies,
    };
  }
}
