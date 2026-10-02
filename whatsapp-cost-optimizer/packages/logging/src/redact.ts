import { maskPhone } from "@wco/domain";

/**
 * Deep redaction for arbitrary objects before logging (spec §23, §57). Never log:
 * access tokens, Authorization headers, webhook secrets, passwords, full customer phones,
 * or message contents.
 */
const SECRET_KEYS = new Set(
  [
    "authorization",
    "cookie",
    "set-cookie",
    "x-api-key",
    "x-hub-signature-256",
    "password",
    "passwordhash",
    "token",
    "accesstoken",
    "access_token",
    "refreshtoken",
    "apikey",
    "api_key",
    "secret",
    "appsecret",
    "app_secret",
    "client_secret",
    "meta_access_token",
    "meta_app_secret",
    "verify_token",
    "hub.verify_token",
    "encryptionkey",
    "jwt",
    "pin",
    "encryptedtoken",
    "phoneencrypted",
  ].map((k) => k.toLowerCase()),
);

const PHONE_KEYS = new Set(
  ["phone", "phonenumber", "customerphone", "to", "from", "wa_id", "waid", "recipient_id", "recipient", "customer", "msisdn", "input"].map(
    (k) => k.toLowerCase(),
  ),
);

const CONTENT_KEYS = new Set(["body", "text", "caption", "content", "message_text", "data"].map((k) => k.toLowerCase()));

const PHONE_PATTERN = /\+?\d{10,15}/g;

/** Only values that look like phone numbers are masked (status strings like "READY_TO_SEND" are kept). */
function looksLikePhone(v: string): boolean {
  const digits = v.replace(/[\s()+-]/g, "");
  return /^\d{8,15}$/.test(digits);
}

export interface RedactOptions {
  /** Keep message contents (default false). */
  keepContent?: boolean;
  maxDepth?: number;
}

export function redact<T>(value: T, opts: RedactOptions = {}, depth = 0): T {
  const maxDepth = opts.maxDepth ?? 8;
  if (depth > maxDepth) return "[Truncated]" as unknown as T;
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.replace(PHONE_PATTERN, (m) => maskPhone(m)) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redact(v, opts, depth + 1)) as unknown as T;
  if (typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const key = k.toLowerCase();
      if (SECRET_KEYS.has(key)) out[k] = "[REDACTED]";
      else if (PHONE_KEYS.has(key) && (typeof v === "string" || typeof v === "number") && looksLikePhone(String(v))) out[k] = maskPhone(String(v));
      else if (!opts.keepContent && CONTENT_KEYS.has(key) && v !== null && typeof v !== "boolean") out[k] = "[CONTENT]";
      else out[k] = redact(v, opts, depth + 1);
    }
    return out as T;
  }
  return value;
}

/** Pino redact paths (fast path for structured log fields). */
export const PINO_REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['x-api-key']",
  "req.headers['x-hub-signature-256']",
  "headers.authorization",
  "*.authorization",
  "*.password",
  "*.passwordHash",
  "*.accessToken",
  "*.access_token",
  "*.token",
  "*.secret",
  "*.appSecret",
  "*.apiKey",
  "*.encryptedToken",
  "*.phoneEncrypted",
];
