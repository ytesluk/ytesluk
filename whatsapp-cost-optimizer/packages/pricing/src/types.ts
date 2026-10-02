import type {
  BillingCategory,
  BillingEvent,
  ConversationContext,
  Decimal,
  EntryPointType,
  FreeCondition,
  MessageKind,
  PolicyStatus,
  PricingStatus,
  QuotaScope,
  Confidence,
} from "@wco/domain";

/** Quoted excerpt of an official source that justifies a policy (docs/META-SOURCES.md). */
export interface SourceExcerpt {
  id: string;
  url: string;
  excerpt: string;
}

export interface FreeQuotaRule {
  amount: number;
  scope: QuotaScope;
  period: "MONTH";
}

/** Billing rule for one message category inside a policy version. */
export interface CategoryRule {
  /** "*" or a market id. Market-specific rules override "*". */
  market: string;
  category: BillingCategory;
  messageKind: MessageKind;
  /** The category has a price under this policy (free conditions may still waive it). */
  billable: boolean;
  /** Non-template messages can only be sent inside an open customer service window. */
  requiresCustomerServiceWindow: boolean;
  freeEligibility: FreeCondition[];
  freeQuota?: FreeQuotaRule;
  /** Charged messages accrue toward monthly volume tiers (portfolio, market, category). */
  tiered: boolean;
  /** Rate-card category used to price the message (defaults to `category`). */
  rateCategory?: BillingCategory;
  /** Fallback rate-card category when the rate card has no row for `rateCategory`. */
  rateCategoryFallback?: BillingCategory;
  /** MESSAGE (per delivered message) or TOKEN (Meta Business Agent — not modeled). */
  unit: "MESSAGE" | "TOKEN";
  sourceIds: string[];
}

export interface FreeEntryPointRule {
  entryPoints: EntryPointType[];
  /** Business must reply within N hours of the user's entry-point message. */
  replyWithinHours: number;
  /** Window length from the business reply. */
  windowHours: number;
  /** Optional extension per inbound (only used by UNVERIFIED candidate policies). */
  extendOnInboundHours?: number;
  maxWindowHours?: number;
}

/** A versioned set of Meta billing rules (stored as PricingPolicyVersion + PricingRule rows). */
export interface PolicyDefinition {
  id: string;
  name: string;
  /** Inclusive local dates (YYYY-MM-DD) in the WABA timezone. */
  effectiveFrom: string;
  effectiveUntil: string | null;
  status: PolicyStatus;
  sourceUrl: string;
  sourceCheckedAt: string;
  sources: SourceExcerpt[];
  notes: string;
  billingEvent: BillingEvent;
  customerServiceWindowHours: number;
  freeEntryPoint: FreeEntryPointRule;
  rules: CategoryRule[];
}

/** One rate row of an imported rate card. */
export interface RateRow {
  market: string;
  currency: string;
  category: BillingCategory;
  tierStart: number;
  tierEnd: number | null;
  unitRate: Decimal;
  effectiveFrom: string;
  effectiveUntil: string | null;
}

export interface RateCardMeta {
  id: string;
  name: string;
  currency: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
  sourceUrl: string;
  sourceDocument: string;
  isDemo: boolean;
  checksum: string;
  /** Catalog market → resolved Meta markets it covers (DEMO "EU" covers FR, DE, ...). */
  marketAliases: Record<string, string[]>;
}

export interface TierInfo {
  index: number;
  start: number;
  end: number | null;
  label: string;
}

export interface WindowEvaluation {
  customerServiceWindow: { open: boolean; expiresAt: Date | null };
  freeEntryPoint: {
    open: boolean;
    expiresAt: Date | null;
    /** This message would be the first qualifying reply and open the FEP window. */
    opensOnThisMessage: boolean;
    eligibleForFreeReply: boolean;
    verification: string | null;
  };
}

/** Input of `PricingPolicy.evaluate` (spec §4). */
export interface PricingContext {
  category: BillingCategory;
  messageKind: MessageKind;
  /** Instant at which the billing event is expected/happened (delivery). */
  at: Date;
  /** WABA timezone (effective dates and monthly resets). */
  timezone: string;
  /** Recipient E.164 — market is derived from the recipient calling code, never from the business. */
  recipient?: string;
  /** Pre-resolved market (skips resolution). */
  market?: string;
  businessPhoneNumberId: string;
  conversation: ConversationContext;
  /** Messages already counted against the applicable free quota in the period (before this one). */
  quotaUsed?: number;
  /** Charged messages already accrued this month for (portfolio, market, category) (before this one). */
  tierPosition?: number;
  /** Business eligible for authentication-international rates (Meta notifies 30 days before). */
  authInternationalEligible?: boolean;
  /** Build the human-readable evidence trail (default true; disabled in bulk simulations). */
  explain?: boolean;
}

/** Spec §5: PricingEligibilityResult. */
export interface PricingEligibilityResult {
  status: PricingStatus;
  /** Eligible for free treatment (FREE or QUOTA). */
  eligible: boolean;
  reason: string;
  /** Effective billing category (may differ from input, e.g. AUTHENTICATION_INTERNATIONAL). */
  category: BillingCategory;
  market: string;
  marketMappingVersion: string;
  currency: string | null;
  /** Rate applied to this message (0 when free). Null when unknown. */
  rate: Decimal | null;
  /** List (first tier) rate of the category/market, for "what it would have cost". */
  listRate: Decimal | null;
  freeReason: string | null;
  policyVersion: string | null;
  rateCardId: string | null;
  isDemoRate: boolean;
  tier: TierInfo | null;
  countsTowardTier: boolean;
  quota: { scope: QuotaScope; scopeKey: string; periodKey: string; amount: number; usedBefore: number } | null;
  windows: WindowEvaluation;
  billingDate: string;
  billingMonth: string;
  chargedOn: BillingEvent;
  /** Human readable trail ("Why charged? / Why free?"). */
  evidence: string[];
}

/** Spec §12: output of CostEngine. */
export interface CostDecision {
  messageIntentId?: string;
  kind: "OPTIMIZED" | "BASELINE" | "ALTERNATIVE" | "REALIZED";
  category: BillingCategory;
  market: string;
  currency: string;
  baseRate: Decimal | null;
  effectiveRate: Decimal;
  isFree: boolean;
  freeReason: string | null;
  pricingStatus: PricingStatus;
  tier: string | null;
  policyVersion: string | null;
  rateCardId: string | null;
  isDemoRate: boolean;
  /** Cost if the message is delivered (Meta charges on delivery). */
  estimatedCost: Decimal;
  confidence: Confidence;
  decisionReason: string;
  evidence: string[];
  eligibility: PricingEligibilityResult;
}
