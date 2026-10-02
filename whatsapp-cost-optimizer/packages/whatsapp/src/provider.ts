/**
 * Provider abstraction (spec §43). All Meta HTTP calls live in MetaCloudApiProvider; nothing else in
 * the codebase talks to graph.facebook.com. Multi-BSP is NOT an MVP goal (spec §67): the interface
 * is provider-agnostic, but only the Meta Cloud API and the Mock are implemented.
 */

export type ProviderKindName = "MOCK" | "META_CLOUD_API";

export interface ProviderCredentials {
  /** Business token / system user token (decrypted just-in-time; never logged). */
  accessToken: string;
}

export interface CommonSendFields {
  /** Meta business phone number id. */
  phoneNumberId: string;
  /** Recipient in E.164. */
  to: string;
  /** Echoed back in status webhooks (`biz_opaque_callback_data`) — WCO puts the attempt id here. */
  bizOpaqueCallbackData?: string;
  /** Mock-only: how the simulated Meta should price the message (ignored by the real provider). */
  mockPricingHint?: { billable: boolean; type: "regular" | "free_customer_service" | "free_entry_point"; category: string };
}

export interface SendTextRequest extends CommonSendFields {
  text: string;
  previewUrl?: boolean;
  replyToMessageId?: string;
}

export interface TemplateParameter {
  name?: string;
  value: string;
}

export interface SendTemplateRequest extends CommonSendFields {
  template: {
    name: string;
    language: string;
    /** Body parameters. Named (`parameter_name`) when the template uses named parameters. */
    bodyParameters: TemplateParameter[];
    parameterFormat?: "NAMED" | "POSITIONAL";
  };
}

export interface SendMediaRequest extends CommonSendFields {
  mediaType: "image" | "document" | "audio" | "video" | "sticker";
  link?: string;
  mediaId?: string;
  caption?: string;
  filename?: string;
}

export interface SendResult {
  providerMessageId: string;
  waId: string | null;
  acceptedAt: Date;
  latencyMs: number;
  /** Template pacing status, if Meta returned one. */
  messageStatus?: string;
}

export interface ProviderMessageInfo {
  providerMessageId: string;
  status: string;
  updatedAt: Date;
}

export interface PhoneNumberInfo {
  id: string;
  displayPhoneNumber: string;
  verifiedName?: string;
  qualityRating?: string;
  throughput?: string;
}

export interface BusinessAccountInfo {
  id: string;
  name?: string;
  timezoneId?: string;
  currency?: string;
}

export interface WebhookVerificationInput {
  rawBody: Buffer | string;
  signatureHeader: string | undefined;
}

export interface WhatsAppProvider {
  readonly kind: ProviderKindName;
  sendMessage(req: SendTextRequest, creds: ProviderCredentials): Promise<SendResult>;
  sendTemplate(req: SendTemplateRequest, creds: ProviderCredentials): Promise<SendResult>;
  sendMedia(req: SendMediaRequest, creds: ProviderCredentials): Promise<SendResult>;
  /** Cloud API reports message status via webhooks only; the real provider throws NOT_SUPPORTED. */
  getMessage(providerMessageId: string, creds: ProviderCredentials): Promise<ProviderMessageInfo>;
  /** Subscribes the app to webhooks on a WABA (POST /<WABA_ID>/subscribed_apps). */
  registerWebhook(wabaId: string, creds: ProviderCredentials): Promise<{ success: boolean }>;
  /** X-Hub-Signature-256 verification over the raw body. */
  validateWebhook(input: WebhookVerificationInput): boolean;
  getPhoneNumber(phoneNumberId: string, creds: ProviderCredentials): Promise<PhoneNumberInfo>;
  getBusinessAccount(wabaId: string, creds: ProviderCredentials): Promise<BusinessAccountInfo>;
}
