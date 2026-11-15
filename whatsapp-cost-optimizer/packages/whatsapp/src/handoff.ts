import { createHash } from "node:crypto";

/**
 * Handoff to the official number: a "click to chat" link (https://wa.me/<number>?text=<text>) that
 * the tenant shows in ANOTHER channel it owns (e-mail, push, in-app banner, SMS). When the customer
 * taps it and sends the pre-filled text, the conversation starts on the tenant's official WhatsApp
 * Business number — a customer-initiated conversation, which opens the customer service window.
 *
 * The WCO never sends WhatsApp messages through anything but the official Cloud API; this link is the
 * only bridge between other channels and WhatsApp.
 */
export interface HandoffLink {
  url: string;
  /** Text pre-filled in the customer's WhatsApp (they still have to tap send). */
  text: string;
  /** Short reference carried in the text, to tell which request the reply answers. */
  ref: string;
}

const REF = /\(ref ([A-Z0-9]{8})\)/;

/** Short, non-reversible reference derived from an internal id (safe to show to the customer). */
export function sessionRef(seed: string): string {
  return createHash("sha256").update(seed).digest("hex").slice(0, 8).toUpperCase();
}

/** https://wa.me/<digits>?text=<url-encoded text> (WhatsApp "click to chat"). */
export function waMeLink(phone: string, text?: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8) throw new Error("waMeLink: a full phone number in international format is required");
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

export function buildHandoffLink(input: { officialPhone: string; seed: string; prompt?: string }): HandoffLink {
  const ref = sessionRef(input.seed);
  const text = `${(input.prompt ?? "Olá!").trim()} (ref ${ref})`;
  return { url: waMeLink(input.officialPhone, text), text, ref };
}

/** The reference of a handoff link inside a message the customer sent, if any. */
export function extractSessionRef(text: string | undefined | null): string | null {
  return text ? (REF.exec(text)?.[1] ?? null) : null;
}
