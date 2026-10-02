import type {
  BillingCategory,
  ConversationContext,
  DecisionAction,
  Decimal,
  MessageKind,
  MessageStatus,
  OpportunityType,
  Priority,
} from "@wco/domain";
import type { CostDecision, CostEngine } from "@wco/pricing";
import type { OptimizationPolicyConfig, PolicyEngine, PolicyEngineResult } from "@wco/policy";

/** Snapshot of a MessageIntent as seen by the (pure) optimization engine. */
export interface IntentRecord {
  id: string;
  tenantId: string;
  /** customerHash — never the plain phone. */
  customerKey: string;
  /** E.164 recipient, only used to resolve the pricing market (not logged). */
  recipient?: string;
  market?: string;
  /** Internal business phone number id. */
  phoneNumberId: string;
  businessEntityId: string | null;
  eventType: string;
  payloadHash: string;
  eventHash: string;
  idempotencyKey: string;
  /** Client event time — ordering for supersession (arrival order is not trusted). */
  occurredAt: Date;
  requestedAt: Date;
  /** Never send before (e.g. "tomorrow 9am" reminders). Defaults to requestedAt. */
  earliestSendAt: Date;
  /** When a system WITHOUT WCO would send (baseline). Defaults to requestedAt. */
  preferredSendAt: Date;
  deadlineAt: Date;
  status: MessageStatus;
  priority: Priority;
  maxDelaySeconds: number;
  mustSendImmediately: boolean;
  allowDeduplication: boolean;
  allowAggregation: boolean;
  allowSupersession: boolean;
  category: BillingCategory;
  messageKind: MessageKind;
  templateName?: string | null;
  templateLanguage?: string | null;
  /** Optional free-form body: enables the "service message inside CSW" alternative when the policy allows it. */
  freeFormText?: string | null;
  data: Record<string, unknown>;
  groupKey: string;
  supersessionKey: string | null;
  consolidationKey: string | null;
  sentAt?: Date | null;
}

export interface ConsentState {
  requireOptIn: boolean;
  optedIn: boolean;
  optedOut: boolean;
  marketingOptedOut: boolean;
}

/** Live counters (month = billing month in the WABA timezone). Override the fixed numbers below. */
export interface PricingCounters {
  tierPosition(market: string, category: BillingCategory, month: string): number;
  quotaUsed(phoneNumberId: string, month: string): number;
}

export interface PricingInputs {
  engine: CostEngine;
  counters?: PricingCounters;
  timezone: string;
  currency: string;
  /** Free-quota usage (service, per business phone number) before this message. */
  quotaUsed: number;
  /** Charged messages accrued this month for (portfolio, market, category) before this message. */
  tierPosition: number;
  authInternationalEligible?: boolean;
}

/** Feature switches — used by the academic experiments (A–F) to isolate each mechanism. */
export interface OptimizationFeatures {
  deduplication: boolean;
  supersession: boolean;
  aggregation: boolean;
  /** Buffering/debounce (required for supersession and aggregation to have anything to act on). */
  debounce: boolean;
  /** Window-aware scheduling, free-form-in-window channel choice and quota awareness. */
  pricingOptimizer: boolean;
}

export const ALL_FEATURES: OptimizationFeatures = {
  deduplication: true,
  supersession: true,
  aggregation: true,
  debounce: true,
  pricingOptimizer: true,
};

export const NO_FEATURES: OptimizationFeatures = {
  deduplication: false,
  supersession: false,
  aggregation: false,
  debounce: false,
  pricingOptimizer: false,
};

export interface DecisionInput {
  intent: IntentRecord;
  policy: OptimizationPolicyConfig;
  now: Date;
  /** Intents of the same buffer group (pending + recently dispatched within the dedup window). */
  related: IntentRecord[];
  consent: ConsentState;
  conversation: ConversationContext;
  pricing: PricingInputs;
  rules: PolicyEngine;
  features?: OptimizationFeatures;
  /** Safety margin before a window closes, since Meta bills on delivery time. */
  windowSafetyMarginSeconds?: number;
  /** Build human-readable explanations (default true; disabled in bulk simulations). */
  explain?: boolean;
}

/** Spec §61. Never a guarantee. */
export interface OptimizationOpportunity {
  type: OpportunityType;
  potentialSaving: Decimal;
  currency: string;
  confidence: number;
  description: string;
}

export interface ScheduleResult {
  sendAt: Date;
  mode: "SEND_NOW" | "SEND_AT" | "CANCEL";
  reasons: string[];
  messageKind: MessageKind;
  category: BillingCategory;
  cost: CostDecision;
  candidatesEvaluated: number;
}

/** Spec §33: explainable decision. */
export interface OptimizationDecision {
  intentId: string;
  action: DecisionAction;
  /** Status the intent must move to. */
  nextStatus: MessageStatus;
  /** For SEND_NOW: now (or earliest). For DELAY/CONSOLIDATE: when the buffer group should flush. */
  sendAt: Date | null;
  reasons: string[];
  rule: PolicyEngineResult;
  facts: Record<string, string | number | boolean | null | undefined>;
  /** Older buffered intents that this intent supersedes. */
  supersedes: string[];
  supersededBy: string | null;
  duplicateOf: string | null;
  /** Deadline inherited from superseded intents (never extend a promised deadline). */
  effectiveDeadline: Date;
  messageKind: MessageKind;
  category: BillingCategory;
  cost: CostDecision | null;
  baselineCost: CostDecision | null;
  alternativeCost: CostDecision | null;
  estimatedSavings: Decimal;
  currency: string;
  opportunities: OptimizationOpportunity[];
  explanation: string[];
}

export interface FlushMessage {
  primaryIntentId: string;
  coveredIntentIds: string[];
  consolidated: boolean;
  templateName: string | null;
  messageKind: MessageKind;
  category: BillingCategory;
  /** Template body parameters (ordered) or free-form text. */
  parameters: Array<{ name: string; value: string }>;
  text: string | null;
  reasons: string[];
}

export interface FlushPlan {
  messages: FlushMessage[];
  consolidated: Array<{ intentId: string; into: string }>;
  notes: string[];
}

export interface TemplateInfo {
  name: string;
  language: string;
  category: BillingCategory;
  approved: boolean;
  consolidationParam?: string | null;
  maxParamLength: number;
  /** Ordered body parameter names. */
  bodyParams: string[];
}
