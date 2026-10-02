import { BUFFERED_STATUSES } from "@wco/domain";
import type { IntentRecord } from "./types";

/**
 * Message supersession (spec §8). Within one supersession stream (same customer, entity and update
 * stream), a newer state replaces older states that have NOT been dispatched yet:
 *
 *   10:00 PROCESSANDO, 10:01 SEPARADO, 10:02 FATURADO, 10:03 ENVIADO  →  one message: "ENVIADO"
 *
 * Ordering uses the client event time (`occurredAt`), so an update that arrives late (out of order)
 * is itself superseded by the newer one already buffered. History is kept (status SUPERSEDED +
 * supersededById) for audit.
 *
 * The surviving intent inherits the EARLIEST deadline of the intents it replaces: a promise made
 * to deliver the older update by time T is still honored (with newer information).
 */
export interface SupersessionResult {
  supersededBy: string | null;
  supersedes: string[];
  effectiveDeadline: Date;
}

export function detectSupersession(intent: IntentRecord, related: IntentRecord[]): SupersessionResult {
  if (!intent.supersessionKey) return { supersededBy: null, supersedes: [], effectiveDeadline: intent.deadlineAt };
  const peers = related.filter(
    (r) => r.id !== intent.id && r.supersessionKey === intent.supersessionKey && BUFFERED_STATUSES.has(r.status) && !r.mustSendImmediately,
  );
  const newer = peers
    .filter((r) => r.occurredAt > intent.occurredAt || (r.occurredAt.getTime() === intent.occurredAt.getTime() && r.requestedAt > intent.requestedAt))
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  if (newer.length > 0) {
    return { supersededBy: newer[0]!.id, supersedes: [], effectiveDeadline: intent.deadlineAt };
  }
  const older = peers.filter((r) => !newer.includes(r));
  let deadline = intent.deadlineAt;
  for (const o of older) if (o.deadlineAt < deadline) deadline = o.deadlineAt;
  return { supersededBy: null, supersedes: older.map((o) => o.id), effectiveDeadline: deadline };
}
