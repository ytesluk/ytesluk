import { EntryPointType, VerificationStatus, addHours, type ConversationContext } from "@wco/domain";
import type { AppContext } from "./context";

type DbLike = Pick<AppContext["db"], "conversation" | "conversationEntryPoint" | "customerServiceWindow">;

/**
 * Loads the raw window facts for (business phone, customer). Whether a window is open is decided by
 * the pricing policy in force at evaluation time — never by these cached projections.
 */
export async function loadConversationContext(db: DbLike, tenantId: string, phoneNumberId: string, customerId: string): Promise<{ context: ConversationContext; conversationId: string | null }> {
  const conv = await db.conversation.findFirst({
    where: { tenantId, phoneNumberId, customerId },
    include: { window: true, entryPoints: { orderBy: { userMessageAt: "desc" }, take: 1 } },
  });
  if (!conv) return { context: { customerServiceWindow: { lastInboundAt: null }, freeEntryPoint: null }, conversationId: null };
  const ep = conv.entryPoints[0];
  return {
    conversationId: conv.id,
    context: {
      customerServiceWindow: { lastInboundAt: conv.window?.lastInboundMessageAt ?? conv.lastInboundAt ?? null, sourceEventId: conv.window?.sourceEventId },
      freeEntryPoint: ep
        ? {
            type: ep.type as EntryPointType,
            userMessageAt: ep.userMessageAt,
            firstBusinessReplyAt: ep.firstBusinessReplyAt,
            windowStartedAt: ep.freeWindowStartedAt,
            confirmedExpiresAt: ep.verificationStatus === "CONFIRMED" ? ep.freeWindowExpiresAt : null,
            verification: ep.verificationStatus as VerificationStatus,
          }
        : null,
    },
  };
}

export async function ensureConversation(db: DbLike, tenantId: string, phoneNumberId: string, customerId: string): Promise<string> {
  const conv = await db.conversation.upsert({
    where: { tenantId_phoneNumberId_customerId: { tenantId, phoneNumberId, customerId } },
    create: { tenantId, phoneNumberId, customerId },
    update: {},
  });
  return conv.id;
}

/**
 * Inbound user message (webhook): opens/resets the customer service window from META's timestamp and
 * records a free entry point when the message carries a Click-to-WhatsApp referral.
 */
export async function recordInbound(
  db: DbLike,
  input: {
    tenantId: string;
    phoneNumberId: string;
    customerId: string;
    customerHash: string;
    at: Date;
    sourceEventId: string;
    windowHours: number;
    policyVersionId: string | null;
    referral?: { sourceType?: string; sourceId?: string; ctwaClid?: string; headline?: string };
  },
): Promise<{ conversationId: string; entryPointId: string | null }> {
  const conversationId = await ensureConversation(db, input.tenantId, input.phoneNumberId, input.customerId);
  const existing = await db.customerServiceWindow.findUnique({ where: { conversationId } });
  // Out-of-order webhooks must not move the window backwards.
  const last = existing && existing.lastInboundMessageAt > input.at ? existing.lastInboundMessageAt : input.at;
  const expiresAt = addHours(last, input.windowHours);
  await db.customerServiceWindow.upsert({
    where: { conversationId },
    create: {
      tenantId: input.tenantId,
      conversationId,
      phoneNumberId: input.phoneNumberId,
      customerPhoneHash: input.customerHash,
      lastInboundMessageAt: last,
      expiresAt,
      status: "OPEN",
      sourceEventId: input.sourceEventId,
      windowHours: input.windowHours,
      policyVersionId: input.policyVersionId,
    },
    update: { lastInboundMessageAt: last, expiresAt, status: "OPEN", sourceEventId: input.sourceEventId, windowHours: input.windowHours, policyVersionId: input.policyVersionId },
  });
  await db.conversation.update({ where: { id: conversationId }, data: { lastInboundAt: last } });

  let entryPointId: string | null = null;
  if (input.referral) {
    const type = input.referral.sourceType === "ad" ? EntryPointType.CLICK_TO_WHATSAPP_AD : EntryPointType.OTHER;
    // An entry point inside an already open FEP window does not open another one.
    const open = await db.conversationEntryPoint.findFirst({
      where: { tenantId: input.tenantId, conversationId, freeWindowExpiresAt: { gt: input.at }, verificationStatus: { not: "REJECTED" } },
    });
    if (!open) {
      const ep = await db.conversationEntryPoint.create({
        data: {
          tenantId: input.tenantId,
          conversationId,
          type,
          source: `${input.referral.sourceType ?? "unknown"}:${input.referral.sourceId ?? "?"}`,
          occurredAt: input.at,
          userMessageAt: input.at,
          // FEP requires the business reply within 24h; the window opens only at that reply.
          eligibility: type === EntryPointType.OTHER ? "NOT_ELIGIBLE" : "ELIGIBLE_PENDING_REPLY",
          sourcePayload: { sourceType: input.referral.sourceType ?? null, sourceId: input.referral.sourceId ?? null, hasClickId: !!input.referral.ctwaClid },
          verificationStatus: "ESTIMATED",
          policyVersionId: input.policyVersionId,
        },
      });
      entryPointId = ep.id;
    }
  }
  return { conversationId, entryPointId };
}

/** First business reply after an entry point: opens the (estimated) FEP window from the reply time. */
export async function markBusinessReply(db: DbLike, tenantId: string, conversationId: string, at: Date, windowHours: number, replyWithinHours: number): Promise<void> {
  const ep = await db.conversationEntryPoint.findFirst({
    where: { tenantId, conversationId, firstBusinessReplyAt: null, eligibility: "ELIGIBLE_PENDING_REPLY" },
    orderBy: { userMessageAt: "desc" },
  });
  if (!ep) return;
  const withinDeadline = at.getTime() - ep.userMessageAt.getTime() < replyWithinHours * 3_600_000;
  await db.conversationEntryPoint.update({
    where: { id: ep.id },
    data: withinDeadline
      ? { firstBusinessReplyAt: at, freeWindowStartedAt: at, freeWindowExpiresAt: addHours(at, windowHours), eligibility: "OPEN" }
      : { firstBusinessReplyAt: at, eligibility: "NOT_ELIGIBLE" },
  });
  await db.conversation.update({ where: { id: conversationId }, data: { lastOutboundAt: at } });
}
