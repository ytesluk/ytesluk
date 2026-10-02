import { Errors } from "./errors";

/**
 * Normalizes a phone number to E.164 ("+5511999999999").
 *
 * Meta: "We highly recommend that you include both the plus sign and country calling code [...]
 * If the plus sign is omitted, your business phone number's country calling code is prepended".
 * WCO therefore requires the "+" (or an explicit default calling code) to avoid misdelivery.
 */
export function normalizePhone(input: string, defaultCallingCode?: string): string {
  const trimmed = input.trim();
  const hasPlus = trimmed.startsWith("+") || trimmed.startsWith("00");
  let digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("00")) digits = digits.slice(2);
  if (!hasPlus) {
    if (!defaultCallingCode) {
      throw Errors.validation("Phone number must be in E.164 format with country calling code (e.g. +5511999999999)");
    }
    digits = defaultCallingCode.replace(/\D/g, "") + digits;
  }
  if (digits.length < 8 || digits.length > 15) {
    throw Errors.validation("Phone number must have between 8 and 15 digits (E.164)");
  }
  return `+${digits}`;
}

export function isE164(value: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(value);
}

/**
 * Masked representation for logs/UI: keeps the leading calling-code digits and the last 4 digits.
 * "+5511999991234" → "+55*******1234". Never log the full number (spec §57).
 */
export function maskPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const digits = e164.replace(/\D/g, "");
  if (digits.length <= 6) return "+" + "*".repeat(digits.length);
  const head = digits.slice(0, 2);
  const tail = digits.slice(-4);
  return `+${head}${"*".repeat(digits.length - 6)}${tail}`;
}

/** Meta webhooks carry `wa_id` / `from` without "+". */
export function fromWaId(waId: string): string {
  return waId.startsWith("+") ? waId : `+${waId.replace(/\D/g, "")}`;
}

export function toWaRecipient(e164: string): string {
  return e164;
}
