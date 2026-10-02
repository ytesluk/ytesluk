import type { IntentRecord } from "./types";

/**
 * Optimization buffer helpers (spec §9, §11) shared by the DB worker and the in-memory simulator.
 *
 * Each buffered intent has:
 *   flushAt      — when it should leave the buffer (trailing debounce end, or a window-driven time)
 *   hardDeadline — never later than this (effective deadline or "just before the free window closes")
 *
 * Debounce is TRAILING and BOUNDED: a newer event in the same aggregation/supersession stream pushes
 * the flush of its peers to its own flush time, but never beyond any peer's hard deadline.
 */
export interface BufferedEntry {
  intent: IntentRecord;
  flushAt: Date;
  hardDeadline: Date;
}

function sameStream(a: IntentRecord, b: IntentRecord): boolean {
  return (!!a.consolidationKey && a.consolidationKey === b.consolidationKey) || (!!a.supersessionKey && a.supersessionKey === b.supersessionKey);
}

/** Returns new flush times for peers of `newcomer` (trailing debounce). */
export function extendDebounce(entries: BufferedEntry[], newcomer: BufferedEntry): Array<{ id: string; flushAt: Date }> {
  const updates: Array<{ id: string; flushAt: Date }> = [];
  for (const e of entries) {
    if (e.intent.id === newcomer.intent.id || !sameStream(e.intent, newcomer.intent)) continue;
    const target = newcomer.flushAt > e.flushAt ? newcomer.flushAt : e.flushAt;
    const bounded = target > e.hardDeadline ? e.hardDeadline : target;
    if (bounded.getTime() !== e.flushAt.getTime()) updates.push({ id: e.intent.id, flushAt: bounded });
  }
  return updates;
}

/** Earliest flush time among buffered entries. */
export function nextFlushTime(entries: BufferedEntry[]): Date | null {
  let min: Date | null = null;
  for (const e of entries) if (!min || e.flushAt < min) min = e.flushAt;
  return min;
}

/**
 * Entries leaving the buffer at `at`: the due ones, plus peers of the same consolidation stream
 * whose content is already allowed to go out (earliestSendAt ≤ at) — merging them saves a message
 * without sending anything early.
 */
export function selectFlushSet(entries: BufferedEntry[], at: Date): { due: BufferedEntry[]; partners: BufferedEntry[] } {
  const due = entries.filter((e) => e.flushAt <= at);
  const dueKeys = new Set(due.map((e) => e.intent.consolidationKey).filter((k): k is string => !!k));
  const partners = entries.filter(
    (e) => !due.includes(e) && !!e.intent.consolidationKey && dueKeys.has(e.intent.consolidationKey) && e.intent.earliestSendAt <= at,
  );
  return { due, partners };
}
