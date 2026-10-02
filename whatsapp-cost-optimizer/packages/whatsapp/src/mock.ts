import { randomBytes, randomUUID } from "node:crypto";
import { classifyMetaError, ProviderError } from "./errors";
import type {
  BusinessAccountInfo,
  CommonSendFields,
  PhoneNumberInfo,
  ProviderMessageInfo,
  SendMediaRequest,
  SendResult,
  SendTemplateRequest,
  SendTextRequest,
  WebhookVerificationInput,
  WhatsAppProvider,
} from "./provider";
import { verifySignature } from "./webhook";

/**
 * MockWhatsAppProvider (spec §42). Fully functional development provider: it accepts sends, returns
 * Meta-shaped responses and later EMITS Meta-shaped status webhooks (sent → delivered → read, or
 * failed) through the `emit` sink, with configurable delays and rates. The worker wires `emit` to a
 * delayed queue job that POSTs the signed payload to WCO's own webhook endpoint, so the whole real
 * pipeline (signature → persist → ACK → queue → processor) is exercised in MOCK mode.
 *
 * Billing in mock mode: the mock does not know Meta's decision, so it echoes the `mockPricingHint`
 * computed by WCO's pricing engine (optionally rejecting a fraction of FEP windows to exercise the
 * verification path). Mock costs are therefore labelled DEMO/MOCK everywhere.
 */
export interface MockOptions {
  appSecret: string;
  wabaId: string;
  displayPhoneNumber?: string;
  deliveryRate?: number;
  readRate?: number;
  maxLatencyMs?: number;
  /** Fraction of sends failing synchronously with a retryable 130429 (exercise retries). */
  syncErrorRate?: number;
  /** Fraction of FEP-free hints reported by "Meta" as regular (e.g. desktop clicks). */
  fepRejectionRate?: number;
  emit?: (payload: Record<string, unknown>, delayMs: number) => void | Promise<void>;
  random?: () => number;
}

interface MockMessage {
  id: string;
  status: string;
  updatedAt: Date;
}

export class MockWhatsAppProvider implements WhatsAppProvider {
  readonly kind = "MOCK" as const;
  readonly sent: Array<{ id: string; type: string; to: string; phoneNumberId: string; body: unknown; at: Date }> = [];
  private readonly messages = new Map<string, MockMessage>();
  private readonly random: () => number;

  constructor(private readonly opts: MockOptions) {
    this.random = opts.random ?? Math.random;
  }

  private maybeFail(): void {
    if ((this.opts.syncErrorRate ?? 0) > 0 && this.random() < (this.opts.syncErrorRate ?? 0)) {
      throw new ProviderError({ message: "Cloud API message throughput has been reached. (mock)", provider: this.kind, providerCode: 130429, httpStatus: 400, classification: classifyMetaError(130429) });
    }
  }

  private async accept(type: string, req: CommonSendFields, body: unknown): Promise<SendResult> {
    this.maybeFail();
    const started = Date.now();
    const id = `wamid.MOCK${randomBytes(18).toString("base64url")}`;
    const at = new Date();
    this.sent.push({ id, type, to: req.to, phoneNumberId: req.phoneNumberId, body, at });
    this.messages.set(id, { id, status: "accepted", updatedAt: at });
    await this.scheduleStatuses(id, req, at);
    return { providerMessageId: id, waId: req.to.replace(/\D/g, ""), acceptedAt: at, latencyMs: Date.now() - started };
  }

  private statusPayload(phoneNumberId: string, status: Record<string, unknown>): Record<string, unknown> {
    return {
      object: "whatsapp_business_account",
      entry: [
        {
          id: this.opts.wabaId,
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { display_phone_number: this.opts.displayPhoneNumber ?? "15550000000", phone_number_id: phoneNumberId },
                statuses: [status],
              },
            },
          ],
        },
      ],
    };
  }

  private async scheduleStatuses(id: string, req: CommonSendFields, at: Date): Promise<void> {
    if (!this.opts.emit) return;
    const max = this.opts.maxLatencyMs ?? 1500;
    const lat = () => Math.round(50 + this.random() * max);
    const recipient = req.to.replace(/\D/g, "");
    const t = (d: number) => String(Math.floor((at.getTime() + d) / 1000));
    let hint = req.mockPricingHint ?? { billable: true, type: "regular" as const, category: "utility" };
    let conversation: Record<string, unknown> | undefined;
    if (hint.type === "free_entry_point") {
      if (this.random() < (this.opts.fepRejectionRate ?? 0)) {
        hint = { ...hint, billable: true, type: "regular" };
      } else {
        conversation = { id: randomUUID().replace(/-/g, ""), origin: { type: "referral_conversion" }, expiration_timestamp: t(72 * 3600 * 1000) };
      }
    }
    const pricing = { billable: hint.billable, pricing_model: "PMP", type: hint.type, category: hint.type === "free_entry_point" ? "referral_conversion" : hint.category };
    const base = { id, recipient_id: recipient, ...(req.bizOpaqueCallbackData ? { biz_opaque_callback_data: req.bizOpaqueCallbackData } : {}) };
    const d1 = lat();
    await this.opts.emit(this.statusPayload(req.phoneNumberId, { ...base, status: "sent", timestamp: t(d1), ...(conversation ? { conversation } : {}) }), d1);
    if (this.random() < (this.opts.deliveryRate ?? 0.97)) {
      const d2 = d1 + lat();
      await this.opts.emit(this.statusPayload(req.phoneNumberId, { ...base, status: "delivered", timestamp: t(d2), pricing }), d2);
      if (this.random() < (this.opts.readRate ?? 0.6)) {
        const d3 = d2 + lat() * 3;
        await this.opts.emit(this.statusPayload(req.phoneNumberId, { ...base, status: "read", timestamp: t(d3) }), d3);
      }
    } else {
      const d2 = d1 + lat();
      await this.opts.emit(
        this.statusPayload(req.phoneNumberId, {
          ...base,
          status: "failed",
          timestamp: t(d2),
          errors: [{ code: 131026, title: "Message undeliverable", message: "Message undeliverable", error_data: { details: "Mock: recipient unreachable" } }],
        }),
        d2,
      );
    }
  }

  sendMessage(req: SendTextRequest): Promise<SendResult> {
    return this.accept("text", req, { text: req.text.length });
  }

  sendTemplate(req: SendTemplateRequest): Promise<SendResult> {
    return this.accept("template", req, { template: req.template.name, params: req.template.bodyParameters.length });
  }

  sendMedia(req: SendMediaRequest): Promise<SendResult> {
    return this.accept(req.mediaType, req, { media: req.mediaType });
  }

  async getMessage(providerMessageId: string): Promise<ProviderMessageInfo> {
    const m = this.messages.get(providerMessageId);
    if (!m) throw new ProviderError({ message: "Unknown message (mock)", provider: this.kind, httpStatus: 404, classification: { retryable: false, action: "INVALID_REQUEST" } });
    return { providerMessageId: m.id, status: m.status, updatedAt: m.updatedAt };
  }

  async registerWebhook(): Promise<{ success: boolean }> {
    return { success: true };
  }

  validateWebhook(input: WebhookVerificationInput): boolean {
    return verifySignature(input.rawBody, input.signatureHeader, this.opts.appSecret);
  }

  async getPhoneNumber(phoneNumberId: string): Promise<PhoneNumberInfo> {
    return { id: phoneNumberId, displayPhoneNumber: this.opts.displayPhoneNumber ?? "+1 555 000 0000", verifiedName: "WCO Mock Business", qualityRating: "GREEN", throughput: "STANDARD" };
  }

  async getBusinessAccount(wabaId: string): Promise<BusinessAccountInfo> {
    return { id: wabaId, name: "WCO Mock WABA", timezoneId: "America/Sao_Paulo", currency: "BRL" };
  }
}

/** Builds a Meta-shaped inbound message webhook (development: simulate a customer writing). */
export function buildInboundPayload(input: {
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber?: string;
  from: string;
  text: string;
  timestamp?: Date;
  referral?: { sourceType: "ad" | "post"; sourceId: string; sourceUrl?: string; headline?: string; ctwaClid?: string };
}): Record<string, unknown> {
  const from = input.from.replace(/\D/g, "");
  const message: Record<string, unknown> = {
    from,
    id: `wamid.MOCKIN${randomBytes(12).toString("base64url")}`,
    timestamp: String(Math.floor((input.timestamp ?? new Date()).getTime() / 1000)),
    type: "text",
    text: { body: input.text },
  };
  if (input.referral) {
    message.referral = {
      source_url: input.referral.sourceUrl ?? "https://fb.me/mock",
      source_id: input.referral.sourceId,
      source_type: input.referral.sourceType,
      headline: input.referral.headline ?? "Chat with us",
      ...(input.referral.sourceType === "ad" ? { ctwa_clid: input.referral.ctwaClid ?? `mock-${randomBytes(6).toString("hex")}` } : {}),
    };
  }
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: input.wabaId,
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: input.displayPhoneNumber ?? "15550000000", phone_number_id: input.phoneNumberId },
              contacts: [{ profile: { name: "Mock Customer" }, wa_id: from }],
              messages: [message],
            },
          },
        ],
      },
    ],
  };
}
