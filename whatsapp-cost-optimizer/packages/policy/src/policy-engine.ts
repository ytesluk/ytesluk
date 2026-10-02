import { z } from "zod";
import { DecisionAction } from "@wco/domain";

/**
 * Declarative rules engine (spec §60). Rules are evaluated in order; the first match decides.
 * Conditions reference FACTS computed deterministically by the OptimizationDecisionEngine — no LLM
 * in the hot path (spec §18).
 *
 *   { "name": "default", "rules": [ { "when": "duplicate", "action": "SUPPRESS" }, ... ] }
 *
 * Invariants are enforced AFTER the rules, so no tenant rule can delay critical/authentication
 * messages or send to opted-out customers.
 */

export type FactValue = boolean | number | string | null | undefined;
export type Facts = Record<string, FactValue>;

export type Condition =
  | string
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { fact: string; equals?: FactValue; in?: FactValue[]; gt?: number; gte?: number; lt?: number; lte?: number };

export type RuleAction = "SUPPRESS" | "SUPERSEDE" | "BLOCK" | "SEND_NOW" | "DELAY" | "CONSOLIDATE" | "CANCEL";

export interface Rule {
  when: Condition;
  action: RuleAction;
  reason?: string;
}

export interface RuleSet {
  name: string;
  version?: string;
  rules: Rule[];
}

const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.string().min(1),
    z.object({ all: z.array(ConditionSchema) }),
    z.object({ any: z.array(ConditionSchema) }),
    z.object({ not: ConditionSchema }),
    z.object({
      fact: z.string().min(1),
      equals: z.union([z.boolean(), z.number(), z.string(), z.null()]).optional(),
      in: z.array(z.union([z.boolean(), z.number(), z.string(), z.null()])).optional(),
      gt: z.number().optional(),
      gte: z.number().optional(),
      lt: z.number().optional(),
      lte: z.number().optional(),
    }),
  ]),
);

export const RuleSetSchema = z.object({
  name: z.string().min(1),
  version: z.string().optional(),
  rules: z
    .array(
      z.object({
        when: ConditionSchema,
        action: z.enum(["SUPPRESS", "SUPERSEDE", "BLOCK", "SEND_NOW", "DELAY", "CONSOLIDATE", "CANCEL"]),
        reason: z.string().optional(),
      }),
    )
    .min(1),
});

/** Facts the decision engine always provides (documented contract for rule authors). */
export const KNOWN_FACTS = [
  "noOptIn",
  "optedOut",
  "marketingOptedOut",
  "isMarketing",
  "nonTemplateOutsideWindow",
  "alreadySent",
  "duplicate",
  "superseded",
  "supersedesPending",
  "critical",
  "authentication",
  "mustSendImmediately",
  "requiresImmediateDelivery",
  "neverDelayEvent",
  "bypassBuffer",
  "canAggregate",
  "canDelay",
  "maxDelayExceeded",
  "freeWindowOpen",
  "freeWindowClosesBeforeDeadline",
  "customerServiceWindowOpen",
  "freeEntryPointOpen",
  "priority",
  "maxDelaySeconds",
  "category",
  "eventType",
] as const;

export function evaluateCondition(c: Condition, facts: Facts): boolean {
  if (typeof c === "string") return facts[c] === true;
  if ("all" in c) return c.all.every((x) => evaluateCondition(x, facts));
  if ("any" in c) return c.any.some((x) => evaluateCondition(x, facts));
  if ("not" in c) return !evaluateCondition(c.not, facts);
  const v = facts[c.fact];
  if (c.equals !== undefined && v !== c.equals) return false;
  if (c.in !== undefined && !c.in.includes(v)) return false;
  if (c.gt !== undefined && !(typeof v === "number" && v > c.gt)) return false;
  if (c.gte !== undefined && !(typeof v === "number" && v >= c.gte)) return false;
  if (c.lt !== undefined && !(typeof v === "number" && v < c.lt)) return false;
  if (c.lte !== undefined && !(typeof v === "number" && v <= c.lte)) return false;
  return true;
}

const ACTION_MAP: Record<RuleAction, DecisionAction> = {
  SUPPRESS: DecisionAction.SUPPRESS_DUPLICATE,
  SUPERSEDE: DecisionAction.SUPERSEDE,
  BLOCK: DecisionAction.BLOCK,
  SEND_NOW: DecisionAction.SEND_NOW,
  DELAY: DecisionAction.DELAY,
  CONSOLIDATE: DecisionAction.CONSOLIDATE,
  CANCEL: DecisionAction.CANCEL,
};

export interface PolicyEngineResult {
  action: DecisionAction;
  reason: string;
  ruleIndex: number | null;
  ruleSet: string;
  invariantApplied: string | null;
}

export const DEFAULT_RULESET: RuleSet = {
  name: "default",
  version: "2026-10-02",
  rules: [
    { when: "optedOut", action: "BLOCK", reason: "customer_opted_out" },
    { when: { all: ["marketingOptedOut", "isMarketing"] }, action: "BLOCK", reason: "marketing_opt_out" },
    { when: "noOptIn", action: "BLOCK", reason: "no_opt_in_recorded" },
    { when: "nonTemplateOutsideWindow", action: "BLOCK", reason: "non_template_outside_customer_service_window" },
    { when: "alreadySent", action: "SUPPRESS", reason: "event_already_sent" },
    { when: "duplicate", action: "SUPPRESS", reason: "duplicate_event" },
    { when: "superseded", action: "SUPERSEDE", reason: "newer_update_pending" },
    { when: "bypassBuffer", action: "SEND_NOW", reason: "critical_or_immediate" },
    { when: "maxDelayExceeded", action: "SEND_NOW", reason: "max_delay_exceeded" },
    { when: "canAggregate", action: "CONSOLIDATE", reason: "aggregation_window" },
    { when: "canDelay", action: "DELAY", reason: "debounce_window" },
    { when: { fact: "maxDelaySeconds", gte: 0 }, action: "SEND_NOW", reason: "no_optimization_applicable" },
  ],
};

export class PolicyEngine {
  constructor(readonly ruleSet: RuleSet = DEFAULT_RULESET) {
    RuleSetSchema.parse(ruleSet);
  }

  static validate(input: unknown): RuleSet {
    return RuleSetSchema.parse(input);
  }

  evaluate(facts: Facts): PolicyEngineResult {
    let action: DecisionAction = DecisionAction.SEND_NOW;
    let reason = "default_send_now";
    let ruleIndex: number | null = null;
    for (let i = 0; i < this.ruleSet.rules.length; i++) {
      const rule = this.ruleSet.rules[i]!;
      if (evaluateCondition(rule.when, facts)) {
        action = ACTION_MAP[rule.action];
        reason = rule.reason ?? (typeof rule.when === "string" ? rule.when : rule.action.toLowerCase());
        ruleIndex = i;
        break;
      }
    }
    // ---- invariants (cannot be overridden by tenant rules)
    let invariantApplied: string | null = null;
    if (facts.optedOut === true && action !== DecisionAction.BLOCK && action !== DecisionAction.SUPPRESS_DUPLICATE) {
      action = DecisionAction.BLOCK;
      reason = "customer_opted_out";
      invariantApplied = "never_send_to_opted_out";
    } else if (facts.nonTemplateOutsideWindow === true && (action === DecisionAction.SEND_NOW || action === DecisionAction.DELAY || action === DecisionAction.CONSOLIDATE)) {
      action = DecisionAction.BLOCK;
      reason = "non_template_outside_customer_service_window";
      invariantApplied = "meta_customer_service_window";
    } else if (facts.bypassBuffer === true && (action === DecisionAction.DELAY || action === DecisionAction.CONSOLIDATE)) {
      action = DecisionAction.SEND_NOW;
      reason = "critical_or_immediate";
      invariantApplied = "never_delay_critical";
    }
    return { action, reason, ruleIndex, ruleSet: this.ruleSet.name, invariantApplied };
  }
}
