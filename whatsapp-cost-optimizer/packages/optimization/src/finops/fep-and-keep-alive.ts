export interface FepKeepAliveInput {
  hasActiveFep72hWindow: boolean;
  fepExpiresAt?: Date | null;
  hasActiveCsw24hWindow: boolean;
  cswExpiresAt?: Date | null;
  scheduledDispatchAt?: Date | null;
  upcomingCategory: 'MARKETING' | 'UTILITY';
  upcomingTemplateCostUsd: number;
  keepAliveEnabled: boolean;
  triggerBeforeExpiryMinutes: number; // Ex: 45
  estimatedReplyRate: number; // 0.0 a 1.0
  monthlyFreeServiceQuotaUsed: number;
  monthlyFreeServiceQuotaLimit?: number;
  serviceUnitCostUsd: number;
  minExpectedNetSavingsUsd?: number;
}

export interface FepKeepAliveDecision {
  action: 'PULL_FORWARD_INTO_FEP_72H' | 'SEND_KEEP_ALIVE_PING' | 'NO_ACTION';
  effectiveCostUsd: number;
  expectedNetSavingsUsd: number;
  reason: string;
}

export function evaluateFepAndKeepAlive(
  input: FepKeepAliveInput,
  now = new Date(),
): FepKeepAliveDecision {
  // 1. Prioridade máxima: Janela gratuita de 72h (Click-to-WhatsApp Ads / CTA Page)
  if (
    input.hasActiveFep72hWindow &&
    (!input.fepExpiresAt || input.fepExpiresAt.getTime() > now.getTime())
  ) {
    const isScheduledLater =
      input.scheduledDispatchAt &&
      input.scheduledDispatchAt.getTime() > now.getTime() &&
      (!input.fepExpiresAt || input.scheduledDispatchAt.getTime() > input.fepExpiresAt.getTime());

    return {
      action: 'PULL_FORWARD_INTO_FEP_72H',
      effectiveCostUsd: 0,
      expectedNetSavingsUsd: input.upcomingTemplateCostUsd,
      reason: isScheduledLater
        ? 'ANTECIPADO_PARA_JANELA_FEP_72H_GRATUITA'
        : 'ENVIADO_NA_JANELA_FEP_72H_GRATUITA',
    };
  }

  // 2. Keep-Alive inteligente antes do fechamento da janela de 24h
  if (!input.keepAliveEnabled || !input.hasActiveCsw24hWindow || !input.cswExpiresAt) {
    return {
      action: 'NO_ACTION',
      effectiveCostUsd: input.upcomingTemplateCostUsd,
      expectedNetSavingsUsd: 0,
      reason: 'KEEP_ALIVE_INATIVO_OU_SEM_JANELA_24H',
    };
  }

  const minsRemaining = (input.cswExpiresAt.getTime() - now.getTime()) / 60_000;
  if (minsRemaining <= 0 || minsRemaining > input.triggerBeforeExpiryMinutes) {
    return {
      action: 'NO_ACTION',
      effectiveCostUsd: input.upcomingTemplateCostUsd,
      expectedNetSavingsUsd: 0,
      reason: 'FORA_DA_JANELA_DE_DISPARO_KEEP_ALIVE',
    };
  }

  const quotaLimit = input.monthlyFreeServiceQuotaLimit ?? 1000;
  const hasFreeQuota = input.monthlyFreeServiceQuotaUsed < quotaLimit;
  const pingCostUsd = hasFreeQuota ? 0 : input.serviceUnitCostUsd;

  const postReplyCostUsd =
    input.upcomingCategory === 'MARKETING' ? pingCostUsd : input.upcomingTemplateCostUsd;

  const grossAvoidedCost = Math.max(0, input.upcomingTemplateCostUsd - postReplyCostUsd);
  const expectedNetSavings = Number(
    (grossAvoidedCost * input.estimatedReplyRate - pingCostUsd).toFixed(6),
  );

  const minSavings = input.minExpectedNetSavingsUsd ?? 0.005;
  if (expectedNetSavings < minSavings) {
    return {
      action: 'NO_ACTION',
      effectiveCostUsd: input.upcomingTemplateCostUsd,
      expectedNetSavingsUsd: expectedNetSavings,
      reason: 'ROI_ESPERADO_INSUFICIENTE',
    };
  }

  return {
    action: 'SEND_KEEP_ALIVE_PING',
    effectiveCostUsd: pingCostUsd,
    expectedNetSavingsUsd: expectedNetSavings,
    reason: hasFreeQuota
      ? 'KEEP_ALIVE_APROVADO_FRANQUIA_GRATUITA'
      : 'KEEP_ALIVE_APROVADO_ARBITRAGEM_POSITIVA',
  };
}
