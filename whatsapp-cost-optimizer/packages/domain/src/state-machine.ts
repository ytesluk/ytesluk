import { MessageStatus } from "./enums";
import { Errors } from "./errors";

/**
 * MessageIntent state machine (spec §28). Every transition must be recorded as a
 * ConversationEvent/AuditLog entry by the caller (see `transition`).
 *
 *  CREATED → PENDING_OPTIMIZATION → (DELAYED | READY_TO_SEND | DEDUPLICATED | SUPERSEDED | BLOCKED | CONSOLIDATED)
 *  DELAYED → (READY_TO_SEND | SUPERSEDED | CONSOLIDATED | DEDUPLICATED | BLOCKED | CANCELLED)
 *  READY_TO_SEND → QUEUED → SENDING → (SENT | FAILED | QUEUED[retry])
 *  SENT → (DELIVERED | READ | FAILED);  DELIVERED → READ
 */
const S = MessageStatus;

export const TRANSITIONS: Readonly<Record<MessageStatus, readonly MessageStatus[]>> = {
  CREATED: [S.PENDING_OPTIMIZATION, S.BLOCKED, S.CANCELLED],
  PENDING_OPTIMIZATION: [
    S.DELAYED,
    S.READY_TO_SEND,
    S.DEDUPLICATED,
    S.SUPERSEDED,
    S.BLOCKED,
    S.CONSOLIDATED,
    S.CANCELLED,
  ],
  DELAYED: [S.READY_TO_SEND, S.SUPERSEDED, S.CONSOLIDATED, S.DEDUPLICATED, S.BLOCKED, S.CANCELLED],
  READY_TO_SEND: [S.QUEUED, S.CANCELLED, S.BLOCKED],
  QUEUED: [S.SENDING, S.CANCELLED, S.FAILED],
  SENDING: [S.SENT, S.FAILED, S.QUEUED],
  SENT: [S.DELIVERED, S.READ, S.FAILED],
  DELIVERED: [S.READ],
  READ: [],
  FAILED: [S.QUEUED],
  CONSOLIDATED: [],
  DEDUPLICATED: [],
  SUPERSEDED: [],
  BLOCKED: [],
  CANCELLED: [],
};

/** Statuses after which the intent will never be dispatched again. */
export const TERMINAL_STATUSES: ReadonlySet<MessageStatus> = new Set([
  S.READ,
  S.CONSOLIDATED,
  S.DEDUPLICATED,
  S.SUPERSEDED,
  S.BLOCKED,
  S.CANCELLED,
]);

/** Statuses in which an intent is still in the optimization buffer and can be merged/replaced. */
export const BUFFERED_STATUSES: ReadonlySet<MessageStatus> = new Set([
  S.CREATED,
  S.PENDING_OPTIMIZATION,
  S.DELAYED,
]);

/** Statuses that mean "a message was (or is being) handed to the provider". */
export const DISPATCHED_STATUSES: ReadonlySet<MessageStatus> = new Set([
  S.READY_TO_SEND,
  S.QUEUED,
  S.SENDING,
  S.SENT,
  S.DELIVERED,
  S.READ,
]);

/** Statuses that represent an avoided message (counted as savings). */
export const AVOIDED_STATUSES: ReadonlySet<MessageStatus> = new Set([
  S.CONSOLIDATED,
  S.DEDUPLICATED,
  S.SUPERSEDED,
]);

export function canTransition(from: MessageStatus, to: MessageStatus): boolean {
  if (from === to) return false;
  return TRANSITIONS[from].includes(to);
}

export interface TransitionRecord {
  from: MessageStatus;
  to: MessageStatus;
  at: Date;
  reason: string;
}

/** Validates a transition and returns the record the caller must persist. */
export function transition(from: MessageStatus, to: MessageStatus, reason: string, at = new Date()): TransitionRecord {
  if (!canTransition(from, to)) throw Errors.invalidTransition(from, to);
  return { from, to, at, reason };
}

/**
 * Delivery-status updates from webhooks may arrive out of order (e.g. `read` before `delivered`).
 * Returns the status that should be stored, never moving "backwards".
 */
const DELIVERY_ORDER: Partial<Record<MessageStatus, number>> = {
  QUEUED: 0,
  SENDING: 1,
  SENT: 2,
  DELIVERED: 3,
  READ: 4,
};

export function mergeDeliveryStatus(current: MessageStatus, incoming: MessageStatus): MessageStatus {
  if (incoming === S.FAILED) {
    // A failure after delivery cannot "undeliver" a message.
    return current === S.DELIVERED || current === S.READ ? current : S.FAILED;
  }
  const c = DELIVERY_ORDER[current];
  const i = DELIVERY_ORDER[incoming];
  if (c === undefined || i === undefined) return incoming;
  return i > c ? incoming : current;
}
