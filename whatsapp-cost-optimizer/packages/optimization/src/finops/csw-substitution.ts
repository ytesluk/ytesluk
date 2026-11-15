export interface InteractiveButtonSpec {
  id: string;
  title: string; // Máximo 20 caracteres na Cloud API
}

export interface CswSubstitutionInput {
  hasActive24hWindow: boolean;
  windowExpiresAt?: Date | null;
  templateCategory: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  templateCostUsd: number;
  renderedBodyText: string;
  buttons?: InteractiveButtonSpec[];
  allowMarketingToFreeForm: boolean;
  hasMarketingConsent: boolean;
  isCriticalOtp?: boolean;
  monthlyFreeServiceQuotaUsed: number;
  monthlyFreeServiceQuotaLimit?: number; // Padrão Meta pós-01/10/2026: 1000
  serviceUnitCostUsd: number; // Ex: 0.0068 (Brasil)
}

export interface CswSubstitutionDecision {
  substituted: boolean;
  deliveryMode: 'TEMPLATE' | 'FREE_FORM_TEXT' | 'FREE_FORM_INTERACTIVE';
  effectiveCostUsd: number;
  savingsUsd: number;
  payload: Record<string, unknown>;
  reason:
    | 'CRITICAL_OTP_LOCKED'
    | 'NO_ACTIVE_24H_WINDOW'
    | 'MARKETING_OPT_IN_OR_POLICY_BLOCKED'
    | 'NO_COST_ADVANTAGE'
    | 'SUBSTITUTED_FREE_QUOTA'
    | 'SUBSTITUTED_LOWER_RATE';
}

export function evaluateCswSubstitution(
  input: CswSubstitutionInput,
  now = new Date(),
): CswSubstitutionDecision {
  if (input.isCriticalOtp || input.templateCategory === 'AUTHENTICATION') {
    return {
      substituted: false,
      deliveryMode: 'TEMPLATE',
      effectiveCostUsd: input.templateCostUsd,
      savingsUsd: 0,
      payload: { type: 'template', body: input.renderedBodyText },
      reason: 'CRITICAL_OTP_LOCKED',
    };
  }

  const windowActive =
    input.hasActive24hWindow &&
    (!input.windowExpiresAt || input.windowExpiresAt.getTime() > now.getTime());

  if (!windowActive) {
    return {
      substituted: false,
      deliveryMode: 'TEMPLATE',
      effectiveCostUsd: input.templateCostUsd,
      savingsUsd: 0,
      payload: { type: 'template', body: input.renderedBodyText },
      reason: 'NO_ACTIVE_24H_WINDOW',
    };
  }

  if (
    input.templateCategory === 'MARKETING' &&
    (!input.allowMarketingToFreeForm || !input.hasMarketingConsent)
  ) {
    return {
      substituted: false,
      deliveryMode: 'TEMPLATE',
      effectiveCostUsd: input.templateCostUsd,
      savingsUsd: 0,
      payload: { type: 'template', body: input.renderedBodyText },
      reason: 'MARKETING_OPT_IN_OR_POLICY_BLOCKED',
    };
  }

  const quotaLimit = input.monthlyFreeServiceQuotaLimit ?? 1000;
  const withinFreeQuota = input.monthlyFreeServiceQuotaUsed < quotaLimit;
  const freeFormCostUsd = withinFreeQuota ? 0 : input.serviceUnitCostUsd;

  if (freeFormCostUsd >= input.templateCostUsd) {
    return {
      substituted: false,
      deliveryMode: 'TEMPLATE',
      effectiveCostUsd: input.templateCostUsd,
      savingsUsd: 0,
      payload: { type: 'template', body: input.renderedBodyText },
      reason: 'NO_COST_ADVANTAGE',
    };
  }

  const validButtons = (input.buttons ?? []).slice(0, 3).map((btn) => ({
    type: 'reply',
    reply: {
      id: btn.id,
      title: btn.title.slice(0, 20),
    },
  }));

  const isInteractive = validButtons.length > 0;
  const payload = isInteractive
    ? {
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: input.renderedBodyText },
          action: { buttons: validButtons },
        },
      }
    : {
        type: 'text',
        text: { preview_url: true, body: input.renderedBodyText },
      };

  return {
    substituted: true,
    deliveryMode: isInteractive ? 'FREE_FORM_INTERACTIVE' : 'FREE_FORM_TEXT',
    effectiveCostUsd: freeFormCostUsd,
    savingsUsd: Number((input.templateCostUsd - freeFormCostUsd).toFixed(6)),
    payload,
    reason: withinFreeQuota ? 'SUBSTITUTED_FREE_QUOTA' : 'SUBSTITUTED_LOWER_RATE',
  };
}
