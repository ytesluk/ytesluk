import type { Prisma } from "@wco/database";
import { AlertSeverity, type AlertType } from "@wco/domain";
import { redact } from "@wco/logging";
import type { AppContext, Actor } from "./context";

type Tx = Pick<AppContext["db"], "auditLog" | "alert" | "conversationEvent">;

/**
 * Audit log (spec §46): creation, changes, sends, cancellations, optimization, price/policy changes,
 * imports, integrations and errors. Snapshots are redacted (no tokens, no full phones, no contents).
 */
export async function audit(
  db: Tx,
  entry: { tenantId: string | null; actor?: Actor | null; action: string; entityType: string; entityId?: string | null; data?: unknown; requestId?: string | null },
): Promise<void> {
  await db.auditLog.create({
    data: {
      tenantId: entry.tenantId,
      actorType: entry.actor?.type ?? "SYSTEM",
      actorId: entry.actor?.id ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      data: entry.data === undefined ? undefined : (redact(entry.data) as Prisma.InputJsonValue),
      requestId: entry.requestId ?? null,
    },
  });
}

export async function auditMany(
  db: Tx,
  entries: Array<{ tenantId: string | null; action: string; entityType: string; entityId?: string | null; data?: unknown; actor?: Actor | null }>,
): Promise<void> {
  if (entries.length === 0) return;
  await db.auditLog.createMany({
    data: entries.map((e) => ({
      tenantId: e.tenantId,
      actorType: e.actor?.type ?? "SYSTEM",
      actorId: e.actor?.id ?? null,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId ?? null,
      data: e.data === undefined ? undefined : (redact(e.data) as Prisma.InputJsonValue),
    })),
  });
}

/** Alerts (spec §93) are de-duplicated by `dedupKey`. */
export async function raiseAlert(
  db: Tx,
  alert: { tenantId: string | null; type: AlertType; severity?: AlertSeverity; title: string; message: string; dedupKey: string; data?: unknown },
): Promise<boolean> {
  try {
    await db.alert.create({
      data: {
        tenantId: alert.tenantId,
        type: alert.type,
        severity: alert.severity ?? AlertSeverity.WARNING,
        title: alert.title,
        message: alert.message,
        dedupKey: alert.dedupKey,
        data: alert.data === undefined ? undefined : (redact(alert.data) as Prisma.InputJsonValue),
      },
    });
    return true;
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return false;
    throw e;
  }
}

export async function event(
  db: Tx,
  e: { tenantId: string; type: string; intentId?: string | null; conversationId?: string | null; occurredAt?: Date; data?: unknown },
): Promise<void> {
  await db.conversationEvent.create({
    data: {
      tenantId: e.tenantId,
      type: e.type,
      intentId: e.intentId ?? null,
      conversationId: e.conversationId ?? null,
      occurredAt: e.occurredAt ?? new Date(),
      data: e.data === undefined ? undefined : (redact(e.data, { keepContent: true }) as Prisma.InputJsonValue),
    },
  });
}
