// eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for the FinOps integration
import { runAdvancedFinOps, type AdvancedFinOpsInput } from "./advanced-finops-hook";
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

  /**
   * 1. Chamar no webhook `statuses` da Meta quando status === 'failed'
   */
  public async onMetaStatusFailed(recipientPhone: string, errorCode: number | string) {
    return this.cache.recordMetaFailure(recipientPhone, errorCode);
  }

  /**
   * 2. Chamar no webhook `messages` da Meta quando o cliente envia mensagem (inbound)
   */
  public async onMetaInboundMessage(senderPhone: string): Promise<void> {
    await this.cache.clearOnInboundMessage(senderPhone);
  }

  /**
   * 3. Chamar no webhook `template_category_update` da Meta
   */
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

  /**
   * 4. Chamar antes de disparar qualquer mensagem no worker/API de envio
   */
  public async routeAndPersist(
    input: Omit<FinOpsDispatchContext, 'monthlyFreeServiceQuotaUsed' | 'mirrorVariants'> & { advanced?: AdvancedFinOpsInput },
    now = new Date(),
  ): Promise<FinOpsRoutingDecision> {
    const [monthlyFreeServiceQuotaUsed, mirrorVariants] = await Promise.all([
      this.repo.getMonthlyFreeServiceQuotaUsed((input.directRouteConfig?.phoneNumberId ?? "default"), now),
      input.templateGroupKey
        ? this.repo.listMirrorVariants(input.tenantId, input.templateGroupKey)
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

    if (
      decision.status === 'DISPATCH' &&
      (decision.deliveryMode === 'CSW_24H_FREE_FORM' || decision.deliveryMode === 'FEP_72H_FREE')
    ) {
      await this.repo.incrementMonthlyServiceQuota(
        input.tenantId,
        input.directRouteConfig.phoneNumberId,
        now,
      );
    }

    await this.repo.recordDecisionLedger(input.tenantId, input.intentId, decision);
    return decision;
  }
}
