export interface ExternalBridgeConfig {
  endpointUrl: string;
  apiKey?: string;
  authHeaderName?: string;
  officialWabaPhone: string;
  appendHandoffLink: boolean;
  handoffCtaText?: string;
  unitCostUsd?: number;
  timeoutMs?: number;
}

export interface BridgeOutboundPayload {
  intentId: string;
  tenantId: string;
  to: string;
  text: string;
  correlationId?: string;
}

export interface BridgeSendResult {
  ok: boolean;
  provider: 'EXTERNAL_HTTP_BRIDGE';
  providerMessageId?: string;
  handoffUrl: string;
  finalRenderedText: string;
  effectiveCostUsd: number;
  errorMessage?: string;
}

export class ExternalHttpBridgeProvider {
  public readonly name = 'EXTERNAL_HTTP_BRIDGE' as const;

  constructor(private readonly config: ExternalBridgeConfig) {}

  public buildOfficialHandoffUrl(sessionRef: string, prefilledText?: string): string {
    const cleanPhone = this.config.officialWabaPhone.replace(/\D/g, '');
    const baseText = prefilledText?.trim() || 'Olá! Quero continuar meu atendimento.';
    return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(`${baseText} [ref:${sessionRef}]`)}`;
  }

  public injectHandoffIntoText(bodyText: string, sessionRef: string): string {
    if (!this.config.appendHandoffLink) return bodyText;
    const url = this.buildOfficialHandoffUrl(sessionRef);
    const label = this.config.handoffCtaText ?? 'Continuar pelo canal oficial verificável:';
    return `${bodyText}\n\n${label}\n${url}`;
  }

  public prepareDispatch(payload: BridgeOutboundPayload): {
    handoffUrl: string;
    finalRenderedText: string;
    effectiveCostUsd: number;
  } {
    const sessionRef = payload.correlationId ?? payload.intentId;
    return {
      handoffUrl: this.buildOfficialHandoffUrl(sessionRef),
      finalRenderedText: this.injectHandoffIntoText(payload.text, sessionRef),
      effectiveCostUsd: this.config.unitCostUsd ?? 0,
    };
  }

  public async send(payload: BridgeOutboundPayload): Promise<BridgeSendResult> {
    const prepared = this.prepareDispatch(payload);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 10_000);

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.config.apiKey) {
        headers[this.config.authHeaderName ?? 'Authorization'] = this.config.apiKey.startsWith('Bearer ')
          ? this.config.apiKey
          : `Bearer ${this.config.apiKey}`;
      }

      const response = await fetch(this.config.endpointUrl, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          to: payload.to,
          text: prepared.finalRenderedText,
          handoffUrl: prepared.handoffUrl,
          metadata: { intentId: payload.intentId, tenantId: payload.tenantId },
        }),
      });

      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        return {
          ok: false,
          provider: this.name,
          handoffUrl: prepared.handoffUrl,
          finalRenderedText: prepared.finalRenderedText,
          effectiveCostUsd: 0,
          errorMessage: String(data.message ?? response.statusText),
        };
      }

      return {
        ok: true,
        provider: this.name,
        providerMessageId: String(data.messageId ?? data.id ?? `bridge_${Date.now()}`),
        handoffUrl: prepared.handoffUrl,
        finalRenderedText: prepared.finalRenderedText,
        effectiveCostUsd: prepared.effectiveCostUsd,
      };
    } catch (err) {
      return {
        ok: false,
        provider: this.name,
        handoffUrl: prepared.handoffUrl,
        finalRenderedText: prepared.finalRenderedText,
        effectiveCostUsd: 0,
        errorMessage: err instanceof Error ? err.message : 'Bridge network failure',
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
