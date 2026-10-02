import { BillingCategory, Priority } from "@wco/domain";

/**
 * Per-event-type optimization settings (spec §9). Persisted in OptimizationPolicy (tenant-scoped);
 * these are the defaults seeded for new tenants and used by the simulator.
 */
export interface OptimizationPolicyConfig {
  eventType: string;
  maxDelaySeconds: number;
  debounceSeconds: number;
  allowAggregation: boolean;
  allowSupersession: boolean;
  allowDeduplication: boolean;
  dedupWindowSeconds: number;
  priority: Priority;
  requiresImmediateDelivery: boolean;
  supersessionGroup?: string | null;
  consolidationTemplate?: string | null;
  defaultTemplate?: string | null;
  defaultLanguage?: string;
  category?: BillingCategory | null;
  allowFreeFormInWindow: boolean;
  maxConsolidatedItems: number;
  enabled: boolean;
}

export const DEFAULT_POLICY: OptimizationPolicyConfig = {
  eventType: "*",
  maxDelaySeconds: 0,
  debounceSeconds: 0,
  allowAggregation: false,
  allowSupersession: false,
  allowDeduplication: true,
  dedupWindowSeconds: 86_400,
  priority: Priority.NORMAL,
  requiresImmediateDelivery: false,
  allowFreeFormInWindow: false,
  maxConsolidatedItems: 10,
  enabled: true,
  defaultLanguage: "pt_BR",
};

const p = (o: Partial<OptimizationPolicyConfig> & { eventType: string }): OptimizationPolicyConfig => ({ ...DEFAULT_POLICY, ...o });

/** Seeded defaults (tenant-configurable afterwards). */
export const DEFAULT_OPTIMIZATION_POLICIES: OptimizationPolicyConfig[] = [
  p({
    eventType: "order.status",
    maxDelaySeconds: 60,
    debounceSeconds: 30,
    allowSupersession: true,
    allowAggregation: true,
    supersessionGroup: "order.status",
    consolidationTemplate: "order_update_summary",
    defaultTemplate: "order_status_update",
    category: BillingCategory.UTILITY,
  }),
  p({
    eventType: "order.updated",
    maxDelaySeconds: 60,
    debounceSeconds: 30,
    allowSupersession: true,
    allowAggregation: true,
    supersessionGroup: "order.status",
    consolidationTemplate: "order_update_summary",
    defaultTemplate: "order_status_update",
    category: BillingCategory.UTILITY,
  }),
  p({
    eventType: "payment.approved",
    maxDelaySeconds: 60,
    debounceSeconds: 30,
    allowAggregation: true,
    consolidationTemplate: "order_update_summary",
    defaultTemplate: "payment_confirmation",
    category: BillingCategory.UTILITY,
  }),
  p({
    eventType: "shipment.tracking",
    maxDelaySeconds: 120,
    debounceSeconds: 60,
    allowAggregation: true,
    allowSupersession: true,
    supersessionGroup: "shipment.tracking",
    consolidationTemplate: "order_update_summary",
    defaultTemplate: "shipping_update",
    category: BillingCategory.UTILITY,
  }),
  p({
    eventType: "stock.update",
    maxDelaySeconds: 120,
    debounceSeconds: 60,
    allowSupersession: true,
    supersessionGroup: "stock.update",
    defaultTemplate: "back_in_stock",
    category: BillingCategory.MARKETING,
    priority: Priority.LOW,
  }),
  p({
    eventType: "appointment.reminder",
    maxDelaySeconds: 6 * 3600,
    allowSupersession: true,
    supersessionGroup: "appointment.reminder",
    defaultTemplate: "appointment_reminder",
    category: BillingCategory.UTILITY,
  }),
  p({
    eventType: "marketing.campaign",
    maxDelaySeconds: 24 * 3600,
    defaultTemplate: "weekly_offer",
    category: BillingCategory.MARKETING,
    priority: Priority.LOW,
    dedupWindowSeconds: 7 * 86_400,
  }),
  p({
    eventType: "cart.reminder",
    maxDelaySeconds: 12 * 3600,
    allowSupersession: true,
    supersessionGroup: "cart.reminder",
    defaultTemplate: "cart_reminder",
    category: BillingCategory.MARKETING,
    priority: Priority.LOW,
  }),
  p({
    eventType: "support.reply",
    maxDelaySeconds: 0,
    priority: Priority.HIGH,
    category: BillingCategory.SERVICE,
    allowFreeFormInWindow: true,
  }),
  p({
    eventType: "authentication.otp",
    priority: Priority.CRITICAL,
    requiresImmediateDelivery: true,
    defaultTemplate: "otp_code",
    category: BillingCategory.AUTHENTICATION,
    dedupWindowSeconds: 60,
  }),
  p({
    eventType: "critical.security",
    priority: Priority.CRITICAL,
    requiresImmediateDelivery: true,
    defaultTemplate: "security_alert",
    category: BillingCategory.UTILITY,
  }),
  p({
    eventType: "fraud.alert",
    priority: Priority.CRITICAL,
    requiresImmediateDelivery: true,
    defaultTemplate: "fraud_alert",
    category: BillingCategory.UTILITY,
  }),
  { ...DEFAULT_POLICY },
];

/**
 * Event types that are NEVER buffered regardless of tenant configuration (spec §9 and §64):
 * OTP/authentication, fraud, security/critical alerts, urgent and legal notifications and
 * user-requested immediate responses. A safety net on top of explicit flags/priorities.
 */
export const NEVER_DELAY_PATTERNS: RegExp[] = [
  /(^|\.)auth(entication)?(\.|$)/i,
  /otp/i,
  /fraud/i,
  /security/i,
  /critical/i,
  /urgent/i,
  /legal/i,
  /immediate/i,
];

export function isNeverDelayEvent(eventType: string): boolean {
  return NEVER_DELAY_PATTERNS.some((r) => r.test(eventType));
}

/** Most specific match: exact eventType, then prefix wildcard ("order.*"), then "*". */
export function resolvePolicy(eventType: string, policies: OptimizationPolicyConfig[]): OptimizationPolicyConfig {
  const enabled = policies.filter((x) => x.enabled);
  const exact = enabled.find((x) => x.eventType === eventType);
  if (exact) return exact;
  const wildcard = enabled
    .filter((x) => x.eventType.endsWith(".*") && eventType.startsWith(x.eventType.slice(0, -1)))
    .sort((a, b) => b.eventType.length - a.eventType.length)[0];
  if (wildcard) return wildcard;
  return enabled.find((x) => x.eventType === "*") ?? DEFAULT_POLICY;
}
