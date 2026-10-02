import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * Meta webhooks (docs/META-SOURCES.md S4–S6):
 *  - GET verification: hub.mode=subscribe, hub.verify_token, hub.challenge → 200 + challenge.
 *  - POST: X-Hub-Signature-256: sha256=HMAC-SHA256(raw body, app secret).
 *  - Payload: { object: "whatsapp_business_account", entry: [{ id: WABA_ID, changes: [{ field, value }] }] }.
 * Parsing is defensive: unknown fields are ignored, never crash the receiver.
 */

export function verifyChallenge(
  query: Record<string, unknown>,
  verifyToken: string | undefined,
): { ok: true; challenge: string } | { ok: false } {
  const mode = query["hub.mode"];
  const token = query["hub.verify_token"];
  const challenge = query["hub.challenge"];
  if (!verifyToken || mode !== "subscribe" || typeof token !== "string" || typeof challenge !== "string") return { ok: false };
  const a = Buffer.from(token);
  const b = Buffer.from(verifyToken);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false };
  return { ok: true, challenge };
}

export function computeSignature(rawBody: Buffer | string, appSecret: string): string {
  return `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
}

export function verifySignature(rawBody: Buffer | string, header: string | undefined, appSecret: string | undefined): boolean {
  if (!header || !appSecret || !header.startsWith("sha256=")) return false;
  const provided = header.slice("sha256=".length);
  if (!/^[0-9a-f]{64}$/i.test(provided)) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided.toLowerCase(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------------------------------------------------------------- normalized events

export interface StatusEvent {
  type: "status";
  wabaId: string;
  phoneNumberId: string;
  messageId: string;
  status: "sent" | "delivered" | "read" | "failed" | "played" | string;
  timestamp: Date;
  recipientId: string;
  bizOpaqueCallbackData?: string;
  pricing?: { billable?: boolean; pricingModel?: string; type?: string; category?: string };
  conversation?: { id?: string; expiresAt?: Date; originType?: string };
  errors?: Array<{ code: number; title?: string; details?: string }>;
}

export interface InboundMessageEvent {
  type: "inbound";
  wabaId: string;
  phoneNumberId: string;
  messageId: string;
  from: string;
  timestamp: Date;
  messageType: string;
  /** Present for Click-to-WhatsApp ads (source_type "ad") or Page posts ("post"). Text is never kept. */
  referral?: { sourceType?: string; sourceId?: string; sourceUrl?: string; ctwaClid?: string; headline?: string };
  /** Text body is exposed ONLY for opt-out keyword detection and is never persisted. */
  textForKeywordDetection?: string;
}

export interface TemplateStatusEvent {
  type: "template_status";
  wabaId: string;
  event: string;
  templateId?: string;
  templateName?: string;
  language?: string;
  reason?: string;
}

export interface TemplateCategoryEvent {
  type: "template_category";
  wabaId: string;
  templateId?: string;
  templateName?: string;
  language?: string;
  previousCategory?: string;
  newCategory?: string;
  correctCategory?: string;
}

export interface AccountUpdateEvent {
  type: "account_update";
  wabaId: string;
  event: string;
  volumeTier?: { tierUpdateTime?: Date; pricingCategory?: string; tier?: string; effectiveMonth?: string; region?: string };
  violationType?: string;
  restrictions?: Array<{ type?: string; expiration?: Date }>;
}

export interface UserPreferenceEvent {
  type: "user_preference";
  wabaId: string;
  phoneNumberId?: string;
  waId: string;
  category?: string;
  value?: string;
  timestamp?: Date;
}

export interface UnknownEvent {
  type: "unknown";
  wabaId: string;
  field: string;
}

export type WebhookEvent = StatusEvent | InboundMessageEvent | TemplateStatusEvent | TemplateCategoryEvent | AccountUpdateEvent | UserPreferenceEvent | UnknownEvent;

const EnvelopeSchema = z.object({
  object: z.string(),
  entry: z.array(z.object({ id: z.string(), changes: z.array(z.object({ field: z.string(), value: z.record(z.string(), z.unknown()) })).default([]) })).default([]),
});

const ts = (v: unknown): Date => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? new Date(n * 1000) : new Date();
};
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? (v as Array<Record<string, unknown>>) : []);

export function webhookFields(payload: unknown): string[] {
  const parsed = EnvelopeSchema.safeParse(payload);
  if (!parsed.success) return [];
  return [...new Set(parsed.data.entry.flatMap((e) => e.changes.map((c) => c.field)))];
}

/** Phone number ids referenced by a payload (used to resolve the tenant). */
export function webhookPhoneNumberIds(payload: unknown): string[] {
  const parsed = EnvelopeSchema.safeParse(payload);
  if (!parsed.success) return [];
  return [...new Set(parsed.data.entry.flatMap((e) => e.changes.map((c) => str(obj(c.value.metadata).phone_number_id)).filter((x): x is string => !!x)))];
}

export function webhookWabaIds(payload: unknown): string[] {
  const parsed = EnvelopeSchema.safeParse(payload);
  if (!parsed.success) return [];
  return [...new Set(parsed.data.entry.map((e) => e.id))];
}

export function parseWebhook(payload: unknown): WebhookEvent[] {
  const parsed = EnvelopeSchema.safeParse(payload);
  if (!parsed.success || parsed.data.object !== "whatsapp_business_account") return [];
  const events: WebhookEvent[] = [];
  for (const entry of parsed.data.entry) {
    const wabaId = entry.id;
    for (const change of entry.changes) {
      const v = change.value;
      const phoneNumberId = str(obj(v.metadata).phone_number_id) ?? "";
      switch (change.field) {
        case "messages": {
          for (const s of arr(v.statuses)) {
            const pricing = obj(s.pricing);
            const conv = obj(s.conversation);
            events.push({
              type: "status",
              wabaId,
              phoneNumberId,
              messageId: str(s.id) ?? "",
              status: str(s.status) ?? "unknown",
              timestamp: ts(s.timestamp),
              recipientId: str(s.recipient_id) ?? "",
              bizOpaqueCallbackData: str(s.biz_opaque_callback_data),
              pricing: Object.keys(pricing).length
                ? { billable: typeof pricing.billable === "boolean" ? pricing.billable : undefined, pricingModel: str(pricing.pricing_model), type: str(pricing.type), category: str(pricing.category) }
                : undefined,
              conversation: Object.keys(conv).length
                ? { id: str(conv.id), expiresAt: conv.expiration_timestamp !== undefined ? ts(conv.expiration_timestamp) : undefined, originType: str(obj(conv.origin).type) }
                : undefined,
              errors: arr(s.errors).map((e) => ({ code: Number(e.code), title: str(e.title), details: str(obj(e.error_data).details) })),
            });
          }
          for (const m of arr(v.messages)) {
            const ref = obj(m.referral);
            const type = str(m.type) ?? "unknown";
            events.push({
              type: "inbound",
              wabaId,
              phoneNumberId,
              messageId: str(m.id) ?? "",
              from: str(m.from) ?? "",
              timestamp: ts(m.timestamp),
              messageType: type,
              referral: Object.keys(ref).length
                ? { sourceType: str(ref.source_type), sourceId: str(ref.source_id), sourceUrl: str(ref.source_url), ctwaClid: str(ref.ctwa_clid), headline: str(ref.headline) }
                : undefined,
              textForKeywordDetection: type === "text" ? str(obj(m.text).body) : type === "button" ? str(obj(m.button).text) : undefined,
            });
          }
          break;
        }
        case "message_template_status_update":
          events.push({
            type: "template_status",
            wabaId,
            event: str(v.event) ?? "",
            templateId: str(v.message_template_id),
            templateName: str(v.message_template_name),
            language: str(v.message_template_language),
            reason: str(v.reason),
          });
          break;
        case "template_category_update":
          events.push({
            type: "template_category",
            wabaId,
            templateId: str(v.message_template_id),
            templateName: str(v.message_template_name),
            language: str(v.message_template_language),
            previousCategory: str(v.previous_category),
            newCategory: str(v.new_category),
            correctCategory: str(v.correct_category),
          });
          break;
        case "account_update": {
          const tier = obj(v.volume_tier_info);
          events.push({
            type: "account_update",
            wabaId,
            event: str(v.event) ?? "",
            volumeTier: Object.keys(tier).length
              ? {
                  tierUpdateTime: tier.tier_update_time !== undefined ? ts(tier.tier_update_time) : undefined,
                  pricingCategory: str(tier.pricing_category),
                  tier: str(tier.tier),
                  effectiveMonth: str(tier.effective_month),
                  region: str(tier.region),
                }
              : undefined,
            violationType: str(obj(v.violation_info).violation_type),
            restrictions: arr(v.restriction_info).map((r) => ({ type: str(r.restriction_type), expiration: r.expiration !== undefined ? ts(r.expiration) : undefined })),
          });
          break;
        }
        case "user_preferences":
          for (const p of arr(v.user_preferences)) {
            events.push({ type: "user_preference", wabaId, phoneNumberId, waId: str(p.wa_id) ?? "", category: str(p.category), value: str(p.value), timestamp: p.timestamp !== undefined ? ts(p.timestamp) : undefined });
          }
          break;
        default:
          events.push({ type: "unknown", wabaId, field: change.field });
      }
    }
  }
  return events;
}

/** Maps a Meta `pricing.category` webhook value to WCO's BillingCategory. */
export function billingCategoryFromWebhook(category: string | undefined): string | null {
  switch (category) {
    case "marketing":
      return "MARKETING";
    case "marketing_lite":
      return "MARKETING_LITE";
    case "utility":
      return "UTILITY";
    case "authentication":
      return "AUTHENTICATION";
    case "authentication-international":
    case "authentication_international":
      return "AUTHENTICATION_INTERNATIONAL";
    case "service":
      return "SERVICE";
    case "referral_conversion":
      return null; // FEP window — category of the template is kept from our records
    default:
      return null;
  }
}

/** Opt-out keywords (PT/EN/ES) for free-text messages. Conservative: exact short replies only. */
const OPT_OUT = /^\s*(sair|parar|pare|stop|cancelar|descadastrar|unsubscribe|baja|não quero mais|nao quero mais)\s*[.!]?\s*$/i;

export function isOptOutKeyword(text: string | undefined): boolean {
  return !!text && OPT_OUT.test(text);
}
