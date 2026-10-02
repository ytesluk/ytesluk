import { createWriteStream } from "node:fs";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { parse } from "csv-parse/sync";
import type { EntryPointType, Priority } from "@wco/domain";
import type { DatasetEvent } from "./dataset";

/**
 * Dataset CSV export/import (spec §40) so experiments can be re-run from files (reproducibility).
 * Customer identifiers are synthetic; payloads are JSON-encoded.
 */
const HEADER = ["at", "kind", "tag", "duplicate", "customer_key", "recipient", "phone_number_id", "event_type", "entity_id", "idempotency_key", "occurred_at", "earliest_send_at", "preferred_send_at", "max_delay_seconds", "priority", "category", "free_form", "entry_point", "data"];

const q = (v: unknown) => {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function* rows(events: DatasetEvent[]): Generator<string> {
  yield HEADER.join(",") + "\n";
  for (const e of events) {
    if (e.kind === "INBOUND") {
      yield [new Date(e.at).toISOString(), "INBOUND", e.tag, "", e.customerKey, "", e.phoneNumberId, "", "", "", "", "", "", "", "", "", "", e.entryPoint ?? "", ""].map(q).join(",") + "\n";
    } else {
      const s = e.sub;
      yield [
        new Date(e.at).toISOString(), "INTENT", e.tag, e.duplicate ? "1" : "0", s.customerKey, s.recipient, s.phoneNumberId, s.eventType, s.businessEntityId ?? "", s.idempotencyKey ?? "",
        s.occurredAt?.toISOString() ?? "", s.earliestSendAt?.toISOString() ?? "", s.preferredSendAt?.toISOString() ?? "", s.maxDelaySeconds ?? "", s.priority ?? "", s.category ?? "", s.freeFormText ? "1" : "", "", JSON.stringify(s.data ?? {}),
      ].map(q).join(",") + "\n";
    }
  }
}

export async function writeDatasetCsv(path: string, events: DatasetEvent[], gzip = path.endsWith(".gz")): Promise<void> {
  const src = Readable.from(rows(events));
  if (gzip) await pipeline(src, createGzip(), createWriteStream(path));
  else await pipeline(src, createWriteStream(path));
}

export function readDatasetCsv(content: string): DatasetEvent[] {
  const recs = parse(content, { columns: true, skip_empty_lines: true }) as Array<Record<string, string>>;
  const d = (v: string) => (v ? new Date(v) : undefined);
  return recs.map((r) =>
    r.kind === "INBOUND"
      ? { kind: "INBOUND" as const, at: Date.parse(r.at!), customerKey: r.customer_key!, phoneNumberId: r.phone_number_id!, entryPoint: (r.entry_point || undefined) as EntryPointType | undefined, tag: r.tag! }
      : {
          kind: "INTENT" as const,
          at: Date.parse(r.at!),
          tag: r.tag!,
          duplicate: r.duplicate === "1",
          sub: {
            customerKey: r.customer_key!,
            recipient: r.recipient!,
            phoneNumberId: r.phone_number_id!,
            eventType: r.event_type!,
            businessEntityId: r.entity_id || null,
            idempotencyKey: r.idempotency_key || undefined,
            occurredAt: d(r.occurred_at!),
            earliestSendAt: d(r.earliest_send_at!),
            preferredSendAt: d(r.preferred_send_at!),
            maxDelaySeconds: r.max_delay_seconds ? Number(r.max_delay_seconds) : undefined,
            priority: (r.priority || undefined) as Priority | undefined,
            freeFormText: r.free_form === "1" ? "Resposta do atendimento" : null,
            data: JSON.parse(r.data || "{}") as Record<string, unknown>,
          },
        },
  );
}
