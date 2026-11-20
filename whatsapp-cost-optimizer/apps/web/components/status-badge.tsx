"use client";

import { Badge, type BadgeTone } from "./ui";

// Message statuses of the dashboard. Kept out of ui.tsx, whose receipt and badge pieces are also
// used on the public product page: internal status names are not part of what it ships.
const STATUS_TONE: Record<string, BadgeTone> = {
  DELIVERED: "good",
  READ: "good",
  SENT: "info",
  FAILED: "critical",
  BLOCKED: "critical",
  CANCELLED: "warning",
  DEDUPLICATED: "neutral",
  SUPERSEDED: "neutral",
  CONSOLIDATED: "neutral",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "info"}>{label ?? status}</Badge>;
}
