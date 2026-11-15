import { createHmac } from 'node:crypto';

export interface DirectRouteConfig {
  graphApiVersion?: string;
  phoneNumberId: string;
  accessToken: string;
  legacyBspMarkupPerMsgUsd: number; // Ex: 0.008 cobrado por Twilio/Zenvia/Blip
}

export interface DirectRouteResult {
  endpointUrl: string;
  headers: Record<string, string>;
  avoidedBspFeeUsd: number;
}

export interface MirroredWebhookDispatch {
  targetUrl: string;
  signatureHeader: string;
  rawBody: string;
}

export class DirectCloudApiRouter {
  public buildDirectRequest(config: DirectRouteConfig): DirectRouteResult {
    const version = config.graphApiVersion ?? 'v22.0';
    return {
      endpointUrl: `https://graph.facebook.com/${version}/${config.phoneNumberId}/messages`,
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
      },
      avoidedBspFeeUsd: Number(Math.max(0, config.legacyBspMarkupPerMsgUsd).toFixed(6)),
    };
  }
}

export class WebhookMirrorSigner {
  public signPayload(rawBody: string, appSecret: string): string {
    const digest = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');
    return `sha256=${digest}`;
  }

  public prepareMirror(
    targetUrl: string,
    payload: Record<string, unknown>,
    appSecret: string,
  ): MirroredWebhookDispatch {
    const rawBody = JSON.stringify(payload);
    return {
      targetUrl,
      signatureHeader: this.signPayload(rawBody, appSecret),
      rawBody,
    };
  }
}
