/**
 * LGPD data retention (spec §24, §100). Defaults: 90 days for messages; audit logs have their own
 * retention; raw webhook bodies and message payloads are purged earlier (data minimization).
 */
export const ALLOWED_RETENTION_DAYS = [30, 90, 180, 365] as const;
export type RetentionDays = (typeof ALLOWED_RETENTION_DAYS)[number];

export interface DataRetentionPolicyConfig {
  retentionDays: RetentionDays;
  auditRetentionDays: number;
  rawWebhookRetentionDays: number;
  payloadRetentionDays: number;
}

export const DEFAULT_RETENTION: DataRetentionPolicyConfig = {
  retentionDays: 90,
  auditRetentionDays: 365,
  rawWebhookRetentionDays: 30,
  payloadRetentionDays: 30,
};

export function isAllowedRetention(days: number): days is RetentionDays {
  return (ALLOWED_RETENTION_DAYS as readonly number[]).includes(days);
}

export interface RetentionCutoffs {
  messages: Date;
  audit: Date;
  rawWebhooks: Date;
  payloads: Date;
}

export function retentionCutoffs(policy: DataRetentionPolicyConfig, now = new Date()): RetentionCutoffs {
  const d = (days: number) => new Date(now.getTime() - days * 86_400_000);
  return {
    messages: d(policy.retentionDays),
    audit: d(policy.auditRetentionDays),
    rawWebhooks: d(Math.min(policy.rawWebhookRetentionDays, policy.retentionDays)),
    payloads: d(Math.min(policy.payloadRetentionDays, policy.retentionDays)),
  };
}
