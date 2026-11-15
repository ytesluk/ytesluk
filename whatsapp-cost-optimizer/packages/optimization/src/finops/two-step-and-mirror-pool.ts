export type MetaTemplateCategory = 'UTILITY' | 'MARKETING' | 'AUTHENTICATION';
export type MetaTemplateStatus = 'APPROVED' | 'PAUSED' | 'DISABLED' | 'REJECTED';

export interface TwoStepSplitResult {
  splitApplied: boolean;
  step1UtilityText: string;
  step1QuickReplyButton: { id: string; title: string };
  step2DeferredPromoText: string | null;
  estimatedSavingsUsd: number;
}

/**
 * Divide uma comunicação híbrida (ex: status de pedido/boleto + cupom/oferta)
 * em Etapa 1 (Utility barato com botão de resposta) + Etapa 2 (oferta entregue
 * como mensagem livre após o clique do cliente abrir a janela de 24h).
 */
export function splitTwoStepCampaign(params: {
  utilityNoticeText: string;
  promotionalOfferText: string;
  ctaButtonTitle?: string;
  marketingRateUsd: number;
  utilityRateUsd: number;
  freeFormExpectedRateUsd: number;
}): TwoStepSplitResult {
  const step1TotalCost = params.utilityRateUsd + params.freeFormExpectedRateUsd;
  const savings = Number((params.marketingRateUsd - step1TotalCost).toFixed(6));

  if (savings <= 0 || !params.promotionalOfferText.trim()) {
    return {
      splitApplied: false,
      step1UtilityText: `${params.utilityNoticeText}\n\n${params.promotionalOfferText}`.trim(),
      step1QuickReplyButton: { id: 'ack_info', title: 'Ver detalhes' },
      step2DeferredPromoText: null,
      estimatedSavingsUsd: 0,
    };
  }

  return {
    splitApplied: true,
    step1UtilityText: params.utilityNoticeText.trim(),
    step1QuickReplyButton: {
      id: 'unlock_step2_offer',
      title: (params.ctaButtonTitle ?? 'Ver benefício').slice(0, 20),
    },
    step2DeferredPromoText: params.promotionalOfferText.trim(),
    estimatedSavingsUsd: savings,
  };
}

export interface MirrorTemplateVariant {
  id: string;
  tenantId: string;
  groupKey: string;
  metaTemplateName: string;
  language: string;
  category: MetaTemplateCategory;
  status: MetaTemplateStatus;
  priority: number;
  lastReclassifiedAt?: Date | null;
}

export interface MirrorSelectionResult {
  selected: MirrorTemplateVariant | null;
  failedOverFrom?: string;
  reason: 'PRIMARY_UTILITY' | 'FAILOVER_UTILITY' | 'NO_UTILITY_AVAILABLE';
}

export class TemplateMirrorPool {
  public selectHealthyUtilityVariant(
    variants: MirrorTemplateVariant[],
    preferredTemplateName?: string,
  ): MirrorSelectionResult {
    const eligible = variants
      .filter((v) => v.status === 'APPROVED' && v.category === 'UTILITY')
      .sort((a, b) => a.priority - b.priority);

    const fallback = eligible[0];
    if (!fallback) {
      return {
        selected: null,
        failedOverFrom: preferredTemplateName,
        reason: 'NO_UTILITY_AVAILABLE',
      };
    }

    const primary = preferredTemplateName
      ? eligible.find((v) => v.metaTemplateName === preferredTemplateName)
      : fallback;

    if (primary) {
      return { selected: primary, reason: 'PRIMARY_UTILITY' };
    }

    return {
      selected: fallback,
      failedOverFrom: preferredTemplateName,
      reason: 'FAILOVER_UTILITY',
    };
  }

  public handleCategoryUpdate(
    poolVariants: MirrorTemplateVariant[],
    updatedTemplateName: string,
    newCategory: MetaTemplateCategory,
    now = new Date(),
  ): {
    updatedVariant: MirrorTemplateVariant | null;
    nextActiveVariant: MirrorTemplateVariant | null;
    degradedToMarketing: boolean;
  } {
    const target = poolVariants.find((v) => v.metaTemplateName === updatedTemplateName) ?? null;

    if (!target) {
      return { updatedVariant: null, nextActiveVariant: null, degradedToMarketing: false };
    }

    const degradedToMarketing = target.category === 'UTILITY' && newCategory === 'MARKETING';
    target.category = newCategory;

    if (degradedToMarketing) {
      target.lastReclassifiedAt = now;
      target.priority += 1000;
    }

    const next = this.selectHealthyUtilityVariant(poolVariants);
    return {
      updatedVariant: target,
      nextActiveVariant: next.selected,
      degradedToMarketing,
    };
  }
}
