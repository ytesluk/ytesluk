import { createHash, createHmac } from "node:crypto";

/** Canonical JSON (sorted keys, no whitespace) so equal payloads always hash equally. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortDeep(v);
    }
    return out;
  }
  if (value instanceof Date) return value.toISOString();
  return value;
}

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Stable hash of a JSON-like payload (MessageIntent.payloadHash). */
export function payloadHash(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

/**
 * Pseudonymous customer identifier (spec §23 "customerHash"): HMAC-SHA256 with a server-side pepper,
 * so hashes cannot be reversed by brute-forcing the phone-number space without the pepper.
 */
export function customerHash(e164: string, pepper: string): string {
  return createHmac("sha256", pepper).update(e164).digest("hex");
}
