import { payloadHash, sha256Hex } from "@wco/domain";
import type { OptimizationPolicyConfig } from "@wco/policy";

/**
 * Keys used by the buffer (spec §7). All of them contain only pseudonymous identifiers.
 *  - groupKey:         unit of serialization in the buffer (tenant + business phone + customer + entity)
 *  - eventHash:        content identity for deduplication
 *  - supersessionKey:  stream of state updates where the newest replaces older ones
 *  - consolidationKey: intents that can be merged into ONE message (same category + same approved template)
 * Supersession and consolidation require a business entity (order, appointment, ticket…): without
 * one, two updates of the same type could be about different things, and replacing or merging them
 * would drop information the customer needs. Deduplication still applies (identical content).
 */
export function groupKey(tenantId: string, phoneNumberId: string, customerKey: string, businessEntityId: string | null): string {
  return `${tenantId}:${phoneNumberId}:${customerKey}:${businessEntityId ?? "-"}`;
}

export function eventHash(input: {
  eventType: string;
  businessEntityId: string | null;
  payloadHash: string;
  customerKey: string;
  phoneNumberId: string;
  templateName?: string | null;
}): string {
  return sha256Hex(
    [input.eventType, input.businessEntityId ?? "-", input.payloadHash, input.customerKey, input.phoneNumberId, input.templateName ?? "-"].join("|"),
  );
}

export function supersessionKey(group: string, eventType: string, policy: OptimizationPolicyConfig, allow: boolean, businessEntityId: string | null): string | null {
  if (!allow || !policy.allowSupersession || !businessEntityId) return null;
  return `${group}:${policy.supersessionGroup ?? eventType}`;
}

export function consolidationKey(group: string, category: string, policy: OptimizationPolicyConfig, allow: boolean, businessEntityId: string | null, messageKind?: string): string | null {
  if (!allow || !policy.allowAggregation || !businessEntityId) return null;
  // Free-form (service) replies of one conversation can be joined into one message — only for
  // policies that send free-form text inside the window (e.g. inbox replies), never templates.
  if (messageKind === "NON_TEMPLATE") return policy.allowFreeFormInWindow ? `${group}:${category}:freeform` : null;
  if (!policy.consolidationTemplate) return null;
  return `${group}:${category}:${policy.consolidationTemplate}`;
}

export { payloadHash };
