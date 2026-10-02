import type { MessageIntentModel } from "@wco/database";
import type { BillingCategory, MessageKind, MessageStatus, Priority } from "@wco/domain";
import type { IntentRecord } from "@wco/optimization";

/** DB row → engine snapshot. The recipient is passed separately (decrypted only when needed). */
export function toIntentRecord(row: MessageIntentModel, recipient?: string): IntentRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    customerKey: row.customerPhoneHash,
    recipient,
    market: row.market ?? undefined,
    phoneNumberId: row.phoneNumberId,
    businessEntityId: row.businessEntityId,
    eventType: row.eventType,
    payloadHash: row.payloadHash,
    eventHash: row.eventHash,
    idempotencyKey: row.idempotencyKey,
    occurredAt: row.occurredAt,
    requestedAt: row.requestedAt,
    earliestSendAt: row.earliestSendAt,
    preferredSendAt: row.preferredSendAt,
    deadlineAt: row.deadlineAt,
    status: row.status as MessageStatus,
    priority: row.priority as Priority,
    maxDelaySeconds: row.maxDelaySeconds,
    mustSendImmediately: row.mustSendImmediately,
    allowDeduplication: row.allowDeduplication,
    allowAggregation: row.allowAggregation,
    allowSupersession: row.allowSupersession,
    category: (row.category ?? "UTILITY") as BillingCategory,
    messageKind: row.messageKind as MessageKind,
    templateName: row.templateName,
    templateLanguage: row.templateLanguage,
    freeFormText: row.freeFormText,
    data: (row.data as Record<string, unknown> | null) ?? {},
    groupKey: row.groupKey,
    supersessionKey: row.supersessionKey,
    consolidationKey: row.consolidationKey,
    sentAt: row.sentAt,
  };
}

