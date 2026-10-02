import { payloadHash, sha256Hex } from "@wco/domain";
import type { OptimizationPolicyConfig } from "@wco/policy";

/**
 * Keys used by the buffer (spec §7). All of them contain only pseudonymous identifiers.
 *  - groupKey:         unit of serialization in the buffer (tenant + business phone + customer + entity)
 *  - eventHash:        content identity for deduplication
 *  - supersessionKey:  stream of state updates where the newest replaces older ones
 *  - consolidationKey: intents that can be merged into ONE message (same category + same approved template)
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

export function supersessionKey(group: string, eventType: string, policy: OptimizationPolicyConfig, allow: boolean): string | null {
  if (!allow || !policy.allowSupersession) return null;
  return `${group}:${policy.supersessionGroup ?? eventType}`;
}

export function consolidationKey(group: string, category: string, policy: OptimizationPolicyConfig, allow: boolean): string | null {
  if (!allow || !policy.allowAggregation || !policy.consolidationTemplate) return null;
  return `${group}:${category}:${policy.consolidationTemplate}`;
}

export { payloadHash };
