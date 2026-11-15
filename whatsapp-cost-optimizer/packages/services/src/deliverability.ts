import { DeliverabilityKind, NO_DELIVERABILITY_LIMITS, type DeliverabilityState } from "@wco/domain";
import { metrics } from "@wco/logging";
import { deliverabilityCooldownMs, deliverabilitySignal } from "@wco/whatsapp";
import type { AppContext } from "./context";

type DbLike = Pick<AppContext["db"], "recipientDeliverabilityCache">;

/**
 * What Meta told THIS tenant about delivering to a recipient:
 *   131026 (undeliverable)            → do not call the API again for a while;
 *   131049 (per-user marketing limit) → marketing templates wait out a cooldown.
 *
 * Privacy (docs/LGPD.md): rows are keyed by the customer hash (HMAC of the phone with the server
 * pepper), never by the phone; they are tenant-scoped — one tenant's delivery results are never
 * used for, or visible to, another tenant; they expire and are erased with the customer's data.
 */
export async function recordDeliveryFailure(ctx: AppContext, input: { tenantId: string; phoneHash: string; code: number | string | null | undefined; at?: Date }): Promise<DeliverabilityKind | null> {
  const signal = deliverabilitySignal(input.code);
  if (!signal) return null;
  const at = input.at ?? ctx.now();
  const where = { tenantId_phoneHash_kind: { tenantId: input.tenantId, phoneHash: input.phoneHash, kind: signal } };
  const existing = await ctx.db.recipientDeliverabilityCache.findUnique({ where });
  // Status webhooks can be redelivered and arrive out of order: the same failure is counted once.
  if (existing && existing.lastSeenAt.getTime() >= at.getTime()) return signal;
  const strikes = (existing?.strikes ?? 0) + 1;
  const expiresAt = new Date(at.getTime() + deliverabilityCooldownMs(signal, strikes));
  const errorCode = Number(input.code);
  await ctx.db.recipientDeliverabilityCache.upsert({
    where,
    create: { tenantId: input.tenantId, phoneHash: input.phoneHash, kind: signal, errorCode, strikes, firstSeenAt: at, lastSeenAt: at, expiresAt },
    update: { errorCode, strikes, lastSeenAt: at, expiresAt },
  });
  metrics.deliverabilitySignals.inc({ tenant_id: input.tenantId, kind: signal });
  return signal;
}

/** The recipient proved reachable (wrote to the business) or a marketing template was delivered. */
export async function clearDeliverability(db: DbLike, tenantId: string, phoneHash: string, kind: DeliverabilityKind): Promise<number> {
  return (await db.recipientDeliverabilityCache.deleteMany({ where: { tenantId, phoneHash, kind } })).count;
}

export async function loadDeliverability(db: DbLike, tenantId: string, phoneHash: string, now: Date): Promise<DeliverabilityState> {
  const rows = await db.recipientDeliverabilityCache.findMany({ where: { tenantId, phoneHash, expiresAt: { gt: now } } });
  if (rows.length === 0) return NO_DELIVERABILITY_LIMITS;
  return {
    undeliverableUntil: rows.find((r) => r.kind === DeliverabilityKind.UNDELIVERABLE)?.expiresAt ?? null,
    marketingCapUntil: rows.find((r) => r.kind === DeliverabilityKind.MARKETING_FREQUENCY_CAP)?.expiresAt ?? null,
  };
}

/** Entries are kept 30 days past their expiry (so a repeat failure still escalates), then deleted. */
export async function purgeDeliverability(ctx: AppContext): Promise<number> {
  const cutoff = new Date(ctx.now().getTime() - 30 * 86_400_000);
  return (await ctx.db.recipientDeliverabilityCache.deleteMany({ where: { expiresAt: { lt: cutoff } } })).count;
}
