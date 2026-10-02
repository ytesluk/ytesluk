import type { EntryPointType, VerificationStatus } from "./enums";

/**
 * Raw facts about a customer service window. Whether it is OPEN at a given instant is always
 * recomputed by the pricing policy in force (window length is policy data), never trusted from a
 * local timer (spec §5).
 */
export interface CustomerServiceWindowFacts {
  /** Timestamp of the last user message/call, as reported by Meta (webhook `timestamp`). */
  lastInboundAt: Date | null;
  sourceEventId?: string | null;
}

/** Raw facts about a free entry point (Click-to-WhatsApp ad / Facebook Page CTA). */
export interface FreeEntryPointFacts {
  type: EntryPointType;
  /** When the user messaged the business through the entry point. */
  userMessageAt: Date;
  /** First business reply after the entry point message (opens the FEP window if within 24h). */
  firstBusinessReplyAt: Date | null;
  /** Start of the FEP window (= first qualifying business reply). */
  windowStartedAt: Date | null;
  /** Expiry confirmed by Meta (`conversation.expiration_timestamp` in status webhooks), if known. */
  confirmedExpiresAt: Date | null;
  verification: VerificationStatus;
}

export interface ConversationContext {
  customerServiceWindow: CustomerServiceWindowFacts;
  freeEntryPoint: FreeEntryPointFacts | null;
}

export const EMPTY_CONTEXT: ConversationContext = {
  customerServiceWindow: { lastInboundAt: null },
  freeEntryPoint: null,
};

export interface Explanation {
  /** Machine-readable reason codes (e.g. "same_order", "within_60_second_buffer"). */
  reasons: string[];
  /** Human readable sentences, in English, safe to show in UI and audit. */
  notes?: string[];
}
