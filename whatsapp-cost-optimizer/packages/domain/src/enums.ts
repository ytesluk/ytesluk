/**
 * Domain enums. Every enum is a `const` object + union type so it can be used at
 * runtime (validation, UI) and at type level. Names match the Prisma enums 1:1.
 */

function values<T extends Record<string, string>>(o: T): Array<T[keyof T]> {
  return Object.values(o) as Array<T[keyof T]>;
}

/**
 * Category that Meta uses to price a delivered message (`pricing.category` in status webhooks).
 * NOT the same thing as a template category: SERVICE and META_BUSINESS_AGENT are non-template
 * categories, AUTHENTICATION_INTERNATIONAL / MARKETING_LITE are rate variants.
 */
export const BillingCategory = {
  MARKETING: "MARKETING",
  MARKETING_LITE: "MARKETING_LITE",
  UTILITY: "UTILITY",
  AUTHENTICATION: "AUTHENTICATION",
  AUTHENTICATION_INTERNATIONAL: "AUTHENTICATION_INTERNATIONAL",
  SERVICE: "SERVICE",
  META_BUSINESS_AGENT: "META_BUSINESS_AGENT",
} as const;
export type BillingCategory = (typeof BillingCategory)[keyof typeof BillingCategory];
export const BILLING_CATEGORIES = values(BillingCategory);

/** Template categories accepted by Meta when creating/approving a template. */
export const TemplateCategory = {
  MARKETING: "MARKETING",
  UTILITY: "UTILITY",
  AUTHENTICATION: "AUTHENTICATION",
} as const;
export type TemplateCategory = (typeof TemplateCategory)[keyof typeof TemplateCategory];
export const TEMPLATE_CATEGORIES = values(TemplateCategory);

/** Template (pre-approved) vs non-template (free-form, only inside a customer service window). */
export const MessageKind = {
  TEMPLATE: "TEMPLATE",
  NON_TEMPLATE: "NON_TEMPLATE",
} as const;
export type MessageKind = (typeof MessageKind)[keyof typeof MessageKind];

/** Lifecycle of a MessageIntent (spec §28). */
export const MessageStatus = {
  CREATED: "CREATED",
  PENDING_OPTIMIZATION: "PENDING_OPTIMIZATION",
  QUEUED: "QUEUED",
  DELAYED: "DELAYED",
  CONSOLIDATED: "CONSOLIDATED",
  DEDUPLICATED: "DEDUPLICATED",
  SUPERSEDED: "SUPERSEDED",
  BLOCKED: "BLOCKED",
  READY_TO_SEND: "READY_TO_SEND",
  SENDING: "SENDING",
  SENT: "SENT",
  DELIVERED: "DELIVERED",
  READ: "READ",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
} as const;
export type MessageStatus = (typeof MessageStatus)[keyof typeof MessageStatus];
export const MESSAGE_STATUSES = values(MessageStatus);

export const Priority = {
  CRITICAL: "CRITICAL",
  HIGH: "HIGH",
  NORMAL: "NORMAL",
  LOW: "LOW",
} as const;
export type Priority = (typeof Priority)[keyof typeof Priority];
export const PRIORITIES = values(Priority);
export const PRIORITY_RANK: Record<Priority, number> = { CRITICAL: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

/** What the optimization engine decided for one intent. */
export const DecisionAction = {
  SEND_NOW: "SEND_NOW",
  DELAY: "DELAY",
  CONSOLIDATE: "CONSOLIDATE",
  SUPERSEDE: "SUPERSEDE",
  SUPPRESS_DUPLICATE: "SUPPRESS_DUPLICATE",
  BLOCK: "BLOCK",
  CANCEL: "CANCEL",
} as const;
export type DecisionAction = (typeof DecisionAction)[keyof typeof DecisionAction];

/** Result of a pricing evaluation (spec §5). */
export const PricingStatus = {
  FREE: "FREE",
  QUOTA: "QUOTA",
  PAID: "PAID",
  UNKNOWN: "UNKNOWN",
  NOT_ELIGIBLE: "NOT_ELIGIBLE",
} as const;
export type PricingStatus = (typeof PricingStatus)[keyof typeof PricingStatus];

export const EntryPointType = {
  CLICK_TO_WHATSAPP_AD: "CLICK_TO_WHATSAPP_AD",
  FACEBOOK_PAGE_CTA: "FACEBOOK_PAGE_CTA",
  OTHER: "OTHER",
} as const;
export type EntryPointType = (typeof EntryPointType)[keyof typeof EntryPointType];

/** Verification of a locally-estimated window against what Meta reports in webhooks. */
export const VerificationStatus = {
  ESTIMATED: "ESTIMATED",
  CONFIRMED: "CONFIRMED",
  REJECTED: "REJECTED",
  EXPIRED: "EXPIRED",
} as const;
export type VerificationStatus = (typeof VerificationStatus)[keyof typeof VerificationStatus];

export const WindowStatus = {
  OPEN: "OPEN",
  EXPIRED: "EXPIRED",
  NONE: "NONE",
} as const;
export type WindowStatus = (typeof WindowStatus)[keyof typeof WindowStatus];

export const Role = {
  OWNER: "OWNER",
  ADMIN: "ADMIN",
  ANALYST: "ANALYST",
  OPERATOR: "OPERATOR",
} as const;
export type Role = (typeof Role)[keyof typeof Role];
export const ROLES = values(Role);

export const PolicyStatus = {
  DRAFT: "DRAFT",
  ACTIVE: "ACTIVE",
  UNVERIFIED: "UNVERIFIED",
  SUPERSEDED: "SUPERSEDED",
  RETIRED: "RETIRED",
} as const;
export type PolicyStatus = (typeof PolicyStatus)[keyof typeof PolicyStatus];

export const OpportunityType = {
  DUPLICATE: "DUPLICATE",
  SUPERSESSION: "SUPERSESSION",
  CONSOLIDATION: "CONSOLIDATION",
  FREE_WINDOW: "FREE_WINDOW",
  FREE_QUOTA: "FREE_QUOTA",
  VOLUME_TIER: "VOLUME_TIER",
  DIRECT_API: "DIRECT_API",
  BSP_MARKUP: "BSP_MARKUP",
} as const;
export type OpportunityType = (typeof OpportunityType)[keyof typeof OpportunityType];

/** How much evidence backs a cost/savings figure (spec §14 and §106). */
export const Confidence = {
  ESTIMATED: "ESTIMATED",
  REALIZED: "REALIZED",
  RECONCILED: "RECONCILED",
  UNKNOWN: "UNKNOWN",
} as const;
export type Confidence = (typeof Confidence)[keyof typeof Confidence];

export const SavingsKind = {
  META: "META",
  BSP: "BSP",
  INFRASTRUCTURE: "INFRASTRUCTURE",
} as const;
export type SavingsKind = (typeof SavingsKind)[keyof typeof SavingsKind];

export const AlertType = {
  POLICY_CHANGED: "POLICY_CHANGED",
  PRICE_CHANGED: "PRICE_CHANGED",
  QUOTA_NEAR_LIMIT: "QUOTA_NEAR_LIMIT",
  UNEXPECTED_COST_INCREASE: "UNEXPECTED_COST_INCREASE",
  HIGH_DUPLICATE_RATE: "HIGH_DUPLICATE_RATE",
  HIGH_API_ERROR_RATE: "HIGH_API_ERROR_RATE",
  WEBHOOK_FAILURE: "WEBHOOK_FAILURE",
  TEMPLATE_CATEGORY_CHANGED: "TEMPLATE_CATEGORY_CHANGED",
  PAYMENT_METHOD_ISSUE: "PAYMENT_METHOD_ISSUE",
  ACCOUNT_RESTRICTION: "ACCOUNT_RESTRICTION",
} as const;
export type AlertType = (typeof AlertType)[keyof typeof AlertType];

export const AlertSeverity = { INFO: "INFO", WARNING: "WARNING", CRITICAL: "CRITICAL" } as const;
export type AlertSeverity = (typeof AlertSeverity)[keyof typeof AlertSeverity];

export const ConsentType = { OPT_IN: "OPT_IN", OPT_OUT: "OPT_OUT" } as const;
export type ConsentType = (typeof ConsentType)[keyof typeof ConsentType];

/** Scope of a consent record: everything, or only marketing (Meta `user_preferences` / error 131050). */
export const ConsentScope = { ALL: "ALL", MARKETING: "MARKETING" } as const;
export type ConsentScope = (typeof ConsentScope)[keyof typeof ConsentScope];

export const TemplateStatus = {
  DRAFT: "DRAFT",
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  PAUSED: "PAUSED",
  DISABLED: "DISABLED",
} as const;
export type TemplateStatus = (typeof TemplateStatus)[keyof typeof TemplateStatus];

export const AppMode = { DEVELOPMENT: "development", PRODUCTION: "production" } as const;
export type AppMode = (typeof AppMode)[keyof typeof AppMode];

/** Scope at which a free quota is counted (Meta: service free tier is per business phone number). */
export const QuotaScope = {
  PHONE_NUMBER: "PHONE_NUMBER",
  WABA: "WABA",
  BUSINESS_PORTFOLIO: "BUSINESS_PORTFOLIO",
} as const;
export type QuotaScope = (typeof QuotaScope)[keyof typeof QuotaScope];

/** Event that makes a message billable under a policy. */
export const BillingEvent = { DELIVERED: "DELIVERED", SENT: "SENT" } as const;
export type BillingEvent = (typeof BillingEvent)[keyof typeof BillingEvent];

/** Conditions that can make a message free under a pricing rule. */
export const FreeCondition = {
  /** Always free (e.g., service messages between 2024-11-01 and 2026-09-30). */
  ALWAYS: "ALWAYS",
  /** Free when delivered inside an open customer service window (e.g., utility until 2026-09-30). */
  CUSTOMER_SERVICE_WINDOW: "CUSTOMER_SERVICE_WINDOW",
  /** Free when delivered inside an open free-entry-point window. */
  FREE_ENTRY_POINT: "FREE_ENTRY_POINT",
} as const;
export type FreeCondition = (typeof FreeCondition)[keyof typeof FreeCondition];
