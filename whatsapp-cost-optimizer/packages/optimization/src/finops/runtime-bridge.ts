import { runAdvancedFinOps, type AdvancedFinOpsInput } from './advanced-finops-hook';
import { GlobalDeliverabilityCache } from './global-deliverability-cache';
import {
  FinOpsCostOrchestrator,
  type FinOpsDispatchContext,
  type FinOpsRoutingDecision,
} from './finops-orchestrator';
import {
  TemplateMirrorPool,
  type MetaTemplateCategory,
} from './two-step-and-mirror-pool';
import {
  PrismaFinOpsRepository,
  PrismaSuppressionStore,
  type FinOpsPrismaClientLike,
} from './prisma-adapter';

export class FinOpsRuntimeBridge {
  public readonly cache: GlobalDeliverabilityCache;
  public readonly repo: PrismaFinOpsRepository;
  public readonly orchestrator: FinOpsCostOrchestrator;
  private readonly mirrorPool = new TemplateMirrorPool();

  constructor(prisma: FinOpsPrismaClientLike, globalSalt: string) {
    const store = new PrismaSuppressionStore(prisma);
    this.cache = new GlobalDeliverabilityCache(store, globalSalt);
    this.repo = new PrismaFinOpsRepository(prisma);
    this.orchestrator = new FinOpsCostOrchestrator(this.cache);
  }

  public async onMetaStatusFailed(recipientPhone: string, errorCode: number | string) {
    return this.cache.recordMetaFailure(recipientPhone, errorCode);
  }

  public async onMetaInboundMessage(senderPhone: string): Promise<void> {
    await this.cache.clearOnInboundMessage(senderPhone);
  }

  public async onTemplateCategoryUpdated(
    tenantId: string,
    metaTemplateName: string,
    newCategory: MetaTemplateCategory,
  ) {
    const allVariants = await this.repo.listMirrorVariants(tenantId);
    const target = allVariants.find((v) => v.metaTemplateName === metaTemplateName);
    if (!target) return null;

    const groupVariants = allVariants.filter((v) => v.groupKey === target.groupKey);
    const result = this.mirrorPool.handleCategoryUpdate(
      groupVariants,
      metaTemplateName,
      newCategory,
    );

    if (result.updatedVariant) {
      await this.repo.saveMirrorVariantState(result.updatedVariant);
    }

    return result;
  }

  public async commitServiceQuota(
    tenantId: string,
    phoneNumberId: string,
    deliveryMode: FinOpsRoutingDecision['deliveryMode'],
    now = new Date(),
  ): Promise<void> {
    if (
      deliveryMode === 'CSW_24H_FREE_FORM' ||
      deliveryMode === 'FEP_72H_FREE' ||
      deliveryMode === 'KEEP_ALIVE_PING'
    ) {
      await this.repo.incrementMonthlyServiceQuota(tenantId, phoneNumberId, now);
    }
  }

  public async routeAndPersist(
    input: Omit<FinOpsDispatchContext, 'monthlyFreeServiceQuotaUsed' | 'mirrorVariants'> & {
      advanced?: AdvancedFinOpsInput;
      deferQuotaIncrement?: boolean;
    },
    now = new Date(),
  ): Promise<FinOpsRoutingDecision> {
    const [monthlyFreeServiceQuotaUsed, mirrorVariants] = await Promise.all([
      this.repo.getMonthlyFreeServiceQuotaUsed(input.directRouteConfig?.phoneNumberId ?? 'default', now),
      input.templateGroupKey
        ? this.repo.listMirrorVariants(input.tenantId, input.templateGroupKey, input.language)
        : Promise.resolve([]),
    ]);

    const decision = await this.orchestrator.evaluateAndRoute(
      {
        ...input,
        monthlyFreeServiceQuotaUsed,
        mirrorVariants,
      },
      now,
    );

    if (input.advanced && decision.status === 'DISPATCH' && decision.finalTotalCostUsd > 0) {
      const adv = runAdvancedFinOps(input.advanced);
      if (adv.merge?.merged) decision.appliedStrategies.push('M7_DYNAMIC_TEMPLATE_MERGER');
      if (adv.tier && adv.tier.unitSavedUsd > 0) decision.appliedStrategies.push('M8_VOLUME_TIER_ROUTER');
      if (adv.flow && adv.flow.savedUsd > 0) decision.appliedStrategies.push('M9_WHATSAPP_FLOWS_ORCHESTRATOR');

      const boundedExtra = Number(Math.min(decision.finalTotalCostUsd, adv.extraSavedUsd).toFixed(6));
      if (boundedExtra > 0) {
        decision.finalTotalCostUsd = Number((decision.finalTotalCostUsd - boundedExtra).toFixed(6));
        decision.metaTariffSavingsUsd = Number((decision.metaTariffSavingsUsd + boundedExtra).toFixed(6));
        decision.totalSavingsUsd = Number((decision.totalSavingsUsd + boundedExtra).toFixed(6));
      }
    }

    if (decision.status === 'DISPATCH' && !input.deferQuotaIncrement) {
      await this.commitServiceQuota(
        input.tenantId,
        input.directRouteConfig.phoneNumberId,
        decision.deliveryMode,
        now,
      );
    }

    await this.repo.recordDecisionLedger(input.tenantId, input.intentId, decision);
    return decision;
  }
}
