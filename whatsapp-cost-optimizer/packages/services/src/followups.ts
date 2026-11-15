import { z } from "zod";
import { BillingCategory, FollowUpStatus, MessageStatus } from "@wco/domain";
import { FOLLOW_UP_EVENT } from "@wco/policy";
import { audit, event } from "./audit";
import type { Actor, AppContext, TenantConfig } from "./context";

type DbLike = Pick<AppContext["db"], "deferredFollowUp">;

/**
 * Deferred follow-up ("two-step" message). A transactional template stays strictly transactional;
 * whatever was kept out of it (typically an offer) is stored as a free-form follow-up and is sent
 * ONLY IF the customer writes back — which opens the customer service window — before it expires.
 *
 *  - It is a real service message inside the window, priced as Meta prices service messages.
 *  - It needs the consent its content needs: a MARKETING follow-up is not sent to a customer who
 *    opted out of marketing or (when the tenant requires opt-in) never opted in.
 *  - If the customer never writes, it is never sent: nothing is pushed to open a window.
 *  - One follow-up per customer message, oldest first; an opt-out reply sends none.
 */
export const FollowUpSchema = z.object({
  text: z.string().trim().min(1).max(4096).describe("Free-form text sent as a service message if the customer replies"),
  validHours: z.number().int().min(1).max(7 * 24).default(72).describe("How long the follow-up waits for a reply before it is dropped"),
  category: z.enum(["MARKETING", "UTILITY"]).default("MARKETING").describe("What the content is: decides which consent it needs"),
});
export type FollowUpInput = z.infer<typeof FollowUpSchema>;

const SENT: string[] = [MessageStatus.SENT, MessageStatus.DELIVERED, MessageStatus.READ];

export async function createFollowUp(db: DbLike, ctx: AppContext, input: { tenantId: string; intentId: string; customerId: string; phoneNumberId: string; followUp: FollowUpInput; now: Date }): Promise<string> {
  const row = await db.deferredFollowUp.create({
    data: {
      tenantId: input.tenantId,
      intentId: input.intentId,
      customerId: input.customerId,
      phoneNumberId: input.phoneNumberId,
      deferredFreeFormPayload: ctx.vault.encryptSecret(JSON.stringify({ text: input.followUp.text })),
      contentCategory: input.followUp.category as BillingCategory,
      status: FollowUpStatus.PENDING,
      expiresAt: new Date(input.now.getTime() + input.followUp.validHours * 3_600_000),
    },
  });
  return row.id;
}

/**
 * The customer just wrote (the window is open): send the oldest pending follow-up of this
 * conversation whose first message was already sent. Returns the follow-up intent id, if any.
 */
export async function triggerFollowUp(
  ctx: AppContext,
  tenant: TenantConfig,
  input: { customerId: string; phoneNumberId: string; conversationId: string; at: Date },
  createIntent: (actor: Actor, raw: unknown, opts: { contentCategory: BillingCategory }) => Promise<{ intentId: string }>,
): Promise<string | null> {
  const pending = await ctx.db.deferredFollowUp.findMany({
    where: { tenantId: tenant.id, customerId: input.customerId, phoneNumberId: input.phoneNumberId, status: FollowUpStatus.PENDING, expiresAt: { gt: input.at } },
    orderBy: { createdAt: "asc" },
    include: { intent: { select: { status: true, sentAt: true, eventType: true } } },
    take: 20,
  });
  // Only follow-ups whose first message already went out, and before this customer message
  // (Meta's webhook timestamps are whole seconds, hence the one-second tolerance).
  const due = pending.find((f) => SENT.includes(f.intent.status) && !!f.intent.sentAt && f.intent.sentAt.getTime() < input.at.getTime() + 1000);
  if (!due) return null;

  const customer = await ctx.db.customer.findFirstOrThrow({ where: { id: input.customerId, tenantId: tenant.id } });
  const marketing = due.contentCategory === BillingCategory.MARKETING;
  const refused = customer.optedOutAt || customer.erasedAt ? "opted_out" : marketing && customer.marketingOptedOutAt ? "marketing_opt_out" : marketing && tenant.requireOptIn && !customer.optedInAt ? "no_opt_in" : null;
  const phone = ctx.vault.decryptPhone(customer.phoneEncrypted);
  const payload = due.deferredFreeFormPayload ? (JSON.parse(ctx.vault.decryptSecret(due.deferredFreeFormPayload)) as { text?: string }) : null;
  if (refused || !phone || !payload?.text) {
    await ctx.db.deferredFollowUp.update({ where: { id: due.id }, data: { status: FollowUpStatus.CANCELLED, deferredFreeFormPayload: null, payloadPurgedAt: input.at } });
    await audit(ctx.db, { tenantId: tenant.id, action: "followup.cancelled", entityType: "DeferredFollowUp", entityId: due.id, data: { reason: refused ?? "payload_unavailable" } });
    return null;
  }
  // Claim it first: a redelivered webhook must not send the follow-up twice.
  const claimed = await ctx.db.deferredFollowUp.updateMany({ where: { id: due.id, tenantId: tenant.id, status: FollowUpStatus.PENDING }, data: { status: FollowUpStatus.SENT, triggeredAt: input.at } });
  if (claimed.count === 0) return null;

  const actor: Actor = { type: "SYSTEM", id: null, tenantId: tenant.id, role: "ADMIN" };
  const created = await createIntent(
    actor,
    { customer: phone, eventType: FOLLOW_UP_EVENT, entityId: `followup:${due.id}`, category: "SERVICE", text: payload.text, data: { followUpOf: due.intentId }, idempotencyKey: `followup-${due.id}`, phoneNumberId: due.phoneNumberId },
    { contentCategory: due.contentCategory as BillingCategory },
  );
  await ctx.db.deferredFollowUp.update({ where: { id: due.id }, data: { followUpIntentId: created.intentId } });
  await event(ctx.db, { tenantId: tenant.id, type: "FOLLOW_UP_TRIGGERED", intentId: created.intentId, conversationId: input.conversationId, occurredAt: input.at, data: { followUpId: due.id, firstIntentId: due.intentId, contentCategory: due.contentCategory } });
  return created.intentId;
}

/** Follow-ups nobody answered in time are dropped and their text erased. */
export async function expireFollowUps(ctx: AppContext): Promise<number> {
  const now = ctx.now();
  return (await ctx.db.deferredFollowUp.updateMany({ where: { status: FollowUpStatus.PENDING, expiresAt: { lte: now } }, data: { status: FollowUpStatus.EXPIRED, deferredFreeFormPayload: null, payloadPurgedAt: now } })).count;
}
