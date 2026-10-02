import { BUFFERED_STATUSES, DISPATCHED_STATUSES, MessageStatus } from "@wco/domain";
import type { IntentRecord } from "./types";

/**
 * Deduplication engine (spec §7). Two intents are duplicates when they carry the same eventHash
 * (event type + business entity + canonical payload + destination + template) inside the dedup window.
 *
 *  - alreadySent: the twin was already dispatched (SENT/DELIVERED/READ/...) → do not send again.
 *  - duplicate:   the twin is still buffered → keep the earlier one, suppress this one.
 *
 * Idempotency keys are enforced earlier by a unique index (tenantId, idempotencyKey): replaying the
 * same request returns the existing intent instead of creating a new one (spec §26).
 */
const IGNORED: ReadonlySet<string> = new Set([MessageStatus.FAILED, MessageStatus.CANCELLED, MessageStatus.BLOCKED, MessageStatus.SUPERSEDED]);

export interface DedupResult {
  duplicate: boolean;
  alreadySent: boolean;
  duplicateOf: string | null;
}

export function detectDuplicate(intent: IntentRecord, related: IntentRecord[], dedupWindowSeconds: number, now: Date): DedupResult {
  const since = now.getTime() - dedupWindowSeconds * 1000;
  let pendingTwin: IntentRecord | undefined;
  let sentTwin: IntentRecord | undefined;
  for (const r of related) {
    if (r.id === intent.id || r.eventHash !== intent.eventHash) continue;
    if (IGNORED.has(r.status)) continue;
    if (r.requestedAt.getTime() < since) continue;
    // A twin that is itself a duplicate points to the original; follow only originals.
    if (r.status === MessageStatus.DEDUPLICATED) continue;
    if (DISPATCHED_STATUSES.has(r.status) || r.status === MessageStatus.CONSOLIDATED) {
      if (!sentTwin || r.requestedAt < sentTwin.requestedAt) sentTwin = r;
    } else if (BUFFERED_STATUSES.has(r.status)) {
      if (!pendingTwin || r.requestedAt < pendingTwin.requestedAt) pendingTwin = r;
    }
  }
  if (sentTwin) return { duplicate: true, alreadySent: true, duplicateOf: sentTwin.id };
  if (pendingTwin) return { duplicate: true, alreadySent: false, duplicateOf: pendingTwin.id };
  return { duplicate: false, alreadySent: false, duplicateOf: null };
}
