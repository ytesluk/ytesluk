import { AppError } from "@wco/domain";

/**
 * Meta error classification (docs/META-SOURCES.md S8). Retryable errors are retried with
 * exponential backoff and a hard attempt limit; non-retryable ones fail fast (spec §27).
 * Rate limits are respected, never circumvented (spec §55).
 */
export type ErrorAction =
  | "RETRY_BACKOFF"
  | "RATE_LIMIT"
  | "PAIR_RATE_LIMIT"
  | "NEEDS_TEMPLATE"
  | "MARKETING_OPT_OUT"
  | "ECOSYSTEM_LIMIT"
  | "UNDELIVERABLE"
  | "PAYMENT_ISSUE"
  | "AUTH_ISSUE"
  | "ACCOUNT_RESTRICTED"
  | "TEMPLATE_ISSUE"
  | "INVALID_REQUEST"
  | "UNKNOWN";

export interface ErrorClassification {
  retryable: boolean;
  action: ErrorAction;
  /** Minimum wait before retrying (ms), when known. */
  retryAfterMs?: number;
}

const TABLE: Record<number, ErrorClassification> = {
  4: { retryable: true, action: "RATE_LIMIT", retryAfterMs: 60_000 },
  80007: { retryable: true, action: "RATE_LIMIT", retryAfterMs: 60_000 },
  130429: { retryable: true, action: "RATE_LIMIT", retryAfterMs: 1_000 },
  131056: { retryable: true, action: "PAIR_RATE_LIMIT", retryAfterMs: 6_000 },
  131000: { retryable: true, action: "RETRY_BACKOFF" },
  131016: { retryable: true, action: "RETRY_BACKOFF", retryAfterMs: 5_000 },
  131057: { retryable: true, action: "RETRY_BACKOFF", retryAfterMs: 30_000 },
  131047: { retryable: false, action: "NEEDS_TEMPLATE" },
  131049: { retryable: false, action: "ECOSYSTEM_LIMIT" },
  131050: { retryable: false, action: "MARKETING_OPT_OUT" },
  131026: { retryable: false, action: "UNDELIVERABLE" },
  131021: { retryable: false, action: "INVALID_REQUEST" },
  131042: { retryable: false, action: "PAYMENT_ISSUE" },
  131048: { retryable: false, action: "ACCOUNT_RESTRICTED" },
  131031: { retryable: false, action: "ACCOUNT_RESTRICTED" },
  130497: { retryable: false, action: "ACCOUNT_RESTRICTED" },
  368: { retryable: false, action: "ACCOUNT_RESTRICTED" },
  0: { retryable: false, action: "AUTH_ISSUE" },
  3: { retryable: false, action: "AUTH_ISSUE" },
  10: { retryable: false, action: "AUTH_ISSUE" },
  190: { retryable: false, action: "AUTH_ISSUE" },
  200: { retryable: false, action: "AUTH_ISSUE" },
  131005: { retryable: false, action: "AUTH_ISSUE" },
  131008: { retryable: false, action: "INVALID_REQUEST" },
  131009: { retryable: false, action: "INVALID_REQUEST" },
  131051: { retryable: false, action: "INVALID_REQUEST" },
  131053: { retryable: false, action: "INVALID_REQUEST" },
  135000: { retryable: false, action: "INVALID_REQUEST" },
  132000: { retryable: false, action: "TEMPLATE_ISSUE" },
  132001: { retryable: false, action: "TEMPLATE_ISSUE" },
  132005: { retryable: false, action: "TEMPLATE_ISSUE" },
  132007: { retryable: false, action: "TEMPLATE_ISSUE" },
  132012: { retryable: false, action: "TEMPLATE_ISSUE" },
  132015: { retryable: false, action: "TEMPLATE_ISSUE" },
  132016: { retryable: false, action: "TEMPLATE_ISSUE" },
  133010: { retryable: false, action: "INVALID_REQUEST" },
};

export function classifyMetaError(code: number | undefined, httpStatus?: number): ErrorClassification {
  if (code !== undefined && TABLE[code]) return TABLE[code]!;
  if (httpStatus !== undefined) {
    if (httpStatus === 429) return { retryable: true, action: "RATE_LIMIT", retryAfterMs: 5_000 };
    if (httpStatus >= 500) return { retryable: true, action: "RETRY_BACKOFF" };
    if (httpStatus === 401 || httpStatus === 403) return { retryable: false, action: "AUTH_ISSUE" };
    if (httpStatus >= 400) return { retryable: false, action: "INVALID_REQUEST" };
  }
  // Network errors / timeouts.
  return { retryable: true, action: "UNKNOWN" };
}

/**
 * Delivery failures that say something about the RECIPIENT rather than about the request:
 *  - 131026 "Message undeliverable": Meta could not deliver to this number (several possible causes:
 *    not a WhatsApp number, old app version, terms not accepted...). Not billed.
 *  - 131049: Meta did not deliver a marketing template to keep a healthy number of marketing
 *    messages per user. Meta's guidance (docs/META-SOURCES.md S8): wait at least 24 hours before
 *    sending that user another marketing template.
 */
export type DeliverabilitySignal = "UNDELIVERABLE" | "MARKETING_FREQUENCY_CAP";

export function deliverabilitySignal(code: number | string | null | undefined): DeliverabilitySignal | null {
  const n = typeof code === "string" ? Number(code) : code;
  if (n === 131026) return "UNDELIVERABLE";
  if (n === 131049) return "MARKETING_FREQUENCY_CAP";
  return null;
}

/**
 * How long the WCO waits before trying that recipient again, by consecutive occurrence.
 *  - 131049 → 24 h (the minimum Meta asks for), then 48 h, then 72 h. The longer steps are WCO policy.
 *  - 131026 → 1 day, 7 days, then 30 days (WCO policy: Meta publishes no number, and the cause can
 *    be temporary — an outdated app, terms not accepted yet).
 * A customer message clears 131026; a delivered marketing template clears 131049.
 */
export const DELIVERABILITY_COOLDOWN_HOURS: Record<DeliverabilitySignal, readonly number[]> = {
  UNDELIVERABLE: [24, 7 * 24, 30 * 24],
  MARKETING_FREQUENCY_CAP: [24, 48, 72],
};

export function deliverabilityCooldownMs(signal: DeliverabilitySignal, strikes: number): number {
  const steps = DELIVERABILITY_COOLDOWN_HOURS[signal];
  const hours = steps[Math.min(Math.max(1, Math.floor(strikes)), steps.length) - 1]!;
  return hours * 3_600_000;
}

export class ProviderError extends AppError {
  readonly action: ErrorAction;
  readonly retryAfterMs?: number;

  constructor(init: {
    message: string;
    provider: string;
    providerCode?: number | string;
    httpStatus?: number;
    requestId?: string;
    cause?: unknown;
    classification: ErrorClassification;
  }) {
    super({
      code: `PROVIDER_${init.classification.action}`,
      message: init.message,
      provider: init.provider,
      providerCode: init.providerCode,
      requestId: init.requestId,
      retryable: init.classification.retryable,
      httpStatus: init.httpStatus ?? 502,
      cause: init.cause,
    });
    this.name = "ProviderError";
    this.action = init.classification.action;
    this.retryAfterMs = init.classification.retryAfterMs;
  }
}

export function isProviderError(e: unknown): e is ProviderError {
  return e instanceof ProviderError;
}
