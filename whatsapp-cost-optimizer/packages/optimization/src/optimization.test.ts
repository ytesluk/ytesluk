import { describe, expect, it } from "vitest";
import { BillingCategory, DecisionAction, EntryPointType, MessageKind, MessageStatus, Money, Priority, RoutingReason } from "@wco/domain";
import { BUILTIN_POLICIES, CostEngine, PolicyRegistry, demoRateCatalog } from "@wco/pricing";
import { DEFAULT_OPTIMIZATION_POLICIES, DEFAULT_RULESET, PolicyEngine, type OptimizationPolicyConfig } from "@wco/policy";
import {
  ALL_FEATURES,
  DEMO_TEMPLATE_INFOS,
  HttpPromotionalRewriter,
  InMemoryPipeline,
  NO_FEATURES,
  TemplateComplianceSplitter,
  analyzeCategory,
  attributeSavings,
  detectCostAnomaly,
  dispatchRank,
  mechanismFromReasons,
  planFlush,
  consolidationKey,
  type IntentSubmission,
  type OptimizationFeatures,
} from "./index";

const engine = new CostEngine(new PolicyRegistry(BUILTIN_POLICIES), demoRateCatalog());
const T0 = new Date("2026-10-05T13:00:00Z");
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

function pipeline(features: OptimizationFeatures = ALL_FEATURES, policies: OptimizationPolicyConfig[] = DEFAULT_OPTIMIZATION_POLICIES) {
  return new InMemoryPipeline({
    tenantId: "t1",
    timezone: "America/Sao_Paulo",
    currency: "BRL",
    engine,
    rules: new PolicyEngine(DEFAULT_RULESET),
    policies,
    templates: DEMO_TEMPLATE_INFOS,
    features,
    recordDecisions: true,
    explain: true,
  });
}

const base = (over: Partial<IntentSubmission> = {}): IntentSubmission => ({
  customerKey: "cust-1",
  recipient: "+5511999990001",
  phoneNumberId: "pn-1",
  eventType: "order.updated",
  businessEntityId: "ORDER-123",
  data: { orderId: "123", status: "PAID", statusLabel: "pago" },
  ...over,
});

describe("Case 1 — same event twice → one message", () => {
  it("deduplicates an identical event", () => {
    const p = pipeline();
    const a = p.submit(base({ eventType: "payment.approved", data: { orderId: "123", amount: "R$ 10" } }), at(0));
    const b = p.submit(base({ eventType: "payment.approved", data: { orderId: "123", amount: "R$ 10" } }), at(5));
    p.drain();
    expect(b.status).toBe(MessageStatus.DEDUPLICATED);
    expect(p.report.messagesDispatched).toBe(1);
    expect(p.report.deduplicated).toBe(1);
    expect(p.decisions[1]!.duplicateOf).toBe(a.id);
  });

  it("idempotency key replay returns the same intent and never creates a second message", () => {
    const p = pipeline();
    const a = p.submit(base({ idempotencyKey: "evt-1" }), at(0));
    const b = p.submit(base({ idempotencyKey: "evt-1" }), at(1));
    p.drain();
    expect(b.id).toBe(a.id);
    expect(p.report.intents).toBe(1);
    expect(p.report.messagesDispatched).toBe(1);
  });

  it("an event already sent is not sent again within the dedup window", () => {
    const p = pipeline();
    p.submit(base({ eventType: "payment.approved", data: { orderId: "9", amount: "1" } }), at(0));
    p.drain();
    const again = p.submit(base({ eventType: "payment.approved", data: { orderId: "9", amount: "1" } }), at(3600));
    p.drain();
    expect(again.status).toBe(MessageStatus.DEDUPLICATED);
    expect(p.decisions[1]!.reasons).toContain("twin_already_dispatched");
    expect(p.report.messagesDispatched).toBe(1);
  });
});

describe("Case 2 — four updates of the same order within 60s → consolidation", () => {
  it("consolidates distinct updates into one approved summary template", () => {
    const policies = DEFAULT_OPTIMIZATION_POLICIES.map((x) => (x.eventType === "order.updated" ? { ...x, allowSupersession: false } : x));
    const p = pipeline(ALL_FEATURES, policies);
    const statuses = ["separado", "faturado", "enviado", "rastreio BR123"];
    const intents = statuses.map((s, i) => p.submit(base({ data: { orderId: "1234", statusLabel: s, tracking: "BR123" }, occurredAt: at(i * 10) }), at(i * 10)));
    p.drain();
    expect(p.report.messagesDispatched).toBe(1);
    expect(p.report.consolidatedMessages).toBe(1);
    expect(p.report.consolidatedIntents).toBe(3);
    const primary = intents[3]!;
    expect([MessageStatus.DELIVERED, MessageStatus.SENT]).toContain(primary.status);
    for (const i of intents.slice(0, 3)) expect(i.status).toBe(MessageStatus.CONSOLIDATED);
    // Deadline respected: flush happened no later than first intent's deadline (60s).
    expect(primary.sentAt!.getTime()).toBeLessThanOrEqual(at(60).getTime());
  });

  it("plan keeps different categories apart (OTP, order update and promotion are never merged)", () => {
    const mk = (id: string, category: BillingCategory, key: string | null, eventType: string) => ({
      id,
      tenantId: "t1",
      customerKey: "c",
      phoneNumberId: "pn",
      businessEntityId: "E",
      eventType,
      payloadHash: id,
      eventHash: id,
      idempotencyKey: id,
      occurredAt: T0,
      requestedAt: T0,
      earliestSendAt: T0,
      preferredSendAt: T0,
      deadlineAt: at(60),
      status: MessageStatus.DELAYED,
      priority: Priority.NORMAL,
      maxDelaySeconds: 60,
      mustSendImmediately: false,
      allowDeduplication: true,
      allowAggregation: true,
      allowSupersession: false,
      category,
      messageKind: MessageKind.TEMPLATE,
      templateName: "order_status_update",
      data: { statusLabel: id },
      groupKey: "g",
      supersessionKey: null,
      consolidationKey: key,
    });
    const plan = planFlush(
      [
        mk("otp", BillingCategory.AUTHENTICATION, null, "authentication.otp"),
        mk("u1", BillingCategory.UTILITY, "g:UTILITY:order_update_summary", "order.updated"),
        mk("u2", BillingCategory.UTILITY, "g:UTILITY:order_update_summary", "order.updated"),
        mk("promo", BillingCategory.MARKETING, "g:MARKETING:weekly_offer", "marketing.campaign"),
      ],
      {
        policyFor: (t) => DEFAULT_OPTIMIZATION_POLICIES.find((x) => x.eventType === t) ?? DEFAULT_OPTIMIZATION_POLICIES.at(-1)!,
        templateFor: (n) => DEMO_TEMPLATE_INFOS.find((t) => t.name === n),
        features: ALL_FEATURES,
      },
    );
    expect(plan.messages).toHaveLength(3);
    const merged = plan.messages.find((m) => m.consolidated)!;
    expect(merged.coveredIntentIds).toEqual(["u1", "u2"]);
    expect(merged.category).toBe(BillingCategory.UTILITY);
    expect(merged.parameters.find((x) => x.name === "updates")?.value).toBe("u1; u2");
  });
});

describe("Inbox replies (agent.reply)", () => {
  it("joins an agent's consecutive free-form replies into one text, in order, never with templates", () => {
    const reply = DEFAULT_OPTIMIZATION_POLICIES.find((p) => p.eventType === "agent.reply")!;
    const key = consolidationKey("g", BillingCategory.SERVICE, reply, true, "chat:1", MessageKind.NON_TEMPLATE);
    expect(key).toBe("g:SERVICE:freeform");
    // A template policy never yields a free-form key, and no entity → no joining.
    expect(consolidationKey("g", BillingCategory.SERVICE, reply, true, null, MessageKind.NON_TEMPLATE)).toBeNull();
    const support = DEFAULT_OPTIMIZATION_POLICIES.find((p) => p.eventType === "support.reply")!;
    expect(consolidationKey("g", BillingCategory.SERVICE, support, true, "chat:1", MessageKind.NON_TEMPLATE)).toBeNull();
    const mk = (id: string, text: string, sec: number) => ({
      id, tenantId: "t1", customerKey: "c", phoneNumberId: "pn", businessEntityId: "chat:1", eventType: "agent.reply",
      payloadHash: id, eventHash: id, idempotencyKey: id, occurredAt: at(sec), requestedAt: at(sec), earliestSendAt: at(sec), preferredSendAt: at(sec),
      deadlineAt: at(sec + 20), status: MessageStatus.DELAYED, priority: Priority.NORMAL, maxDelaySeconds: 20, mustSendImmediately: false,
      allowDeduplication: false, allowAggregation: true, allowSupersession: false, category: BillingCategory.SERVICE, messageKind: MessageKind.NON_TEMPLATE,
      templateName: null, freeFormText: text, data: { text }, groupKey: "g", supersessionKey: null, consolidationKey: key,
    });
    const plan = planFlush([mk("b", "Tudo bem?", 2), mk("a", "Oi!", 0), mk("c", "Segue o valor", 4)], {
      policyFor: () => reply,
      templateFor: () => undefined,
      features: ALL_FEATURES,
    });
    expect(plan.messages).toHaveLength(1);
    expect(plan.messages[0]).toMatchObject({ messageKind: MessageKind.NON_TEMPLATE, text: "Oi!\nTudo bem?\nSegue o valor", coveredIntentIds: ["a", "b", "c"], primaryIntentId: "c" });
    expect(plan.consolidated).toEqual([{ intentId: "a", into: "c" }, { intentId: "b", into: "c" }]);
  });
});

describe("Case 3 — OTP is never delayed", () => {
  it("sends authentication immediately even with buffering features on", () => {
    const p = pipeline();
    const otp = p.submit(base({ eventType: "authentication.otp", businessEntityId: "login-1", data: { code: "123456" } }), at(0));
    expect(p.decisions[0]!.action).toBe("SEND_NOW");
    expect(p.decisions[0]!.reasons).toContain("authentication_message");
    expect(otp.sentAt?.getTime()).toBe(at(0).getTime());
  });

  it("a tenant rule set cannot delay OTPs (invariant)", () => {
    const hostile = new PolicyEngine({ name: "hostile", rules: [{ when: "authentication", action: "DELAY" }] });
    const r = hostile.evaluate({ authentication: true, bypassBuffer: true });
    expect(r.action).toBe("SEND_NOW");
    expect(r.invariantApplied).toBe("never_delay_critical");
  });
});

describe("Case 4 — critical messages skip the buffer", () => {
  it("sends CRITICAL priority immediately", () => {
    const p = pipeline();
    const crit = p.submit(base({ eventType: "order.updated", priority: Priority.CRITICAL, data: { orderId: "1", statusLabel: "cancelado por fraude" } }), at(0));
    expect(p.decisions[0]!.action).toBe("SEND_NOW");
    expect(crit.sentAt?.getTime()).toBe(at(0).getTime());
  });

  it("mustSendImmediately=true never enters the buffer", () => {
    const p = pipeline();
    const m = p.submit(base({ mustSendImmediately: true }), at(0));
    expect(p.decisions[0]!.action).toBe("SEND_NOW");
    expect(m.sentAt).toBeTruthy();
  });

  it("fraud/security event types are never delayed even if misconfigured", () => {
    const policies = [...DEFAULT_OPTIMIZATION_POLICIES, { ...DEFAULT_OPTIMIZATION_POLICIES.at(-1)!, eventType: "fraud.suspicious", debounceSeconds: 300, maxDelaySeconds: 600 }];
    const p = pipeline(ALL_FEATURES, policies);
    p.submit(base({ eventType: "fraud.suspicious" }), at(0));
    expect(p.decisions[0]!.action).toBe("SEND_NOW");
  });
});

describe("Spec §63 — ORDER_CREATED, PAYMENT_APPROVED, ORDER_PACKED, ORDER_SHIPPED", () => {
  it("4 events → 1 message, 3 superseded, estimated savings recorded", () => {
    const p = pipeline();
    const steps = ["ORDER_CREATED", "PAYMENT_APPROVED", "ORDER_PACKED", "ORDER_SHIPPED"];
    const intents = steps.map((s, i) => p.submit(base({ eventType: "order.status", data: { orderId: "1234", status: s, statusLabel: s }, occurredAt: at(i * 15) }), at(i * 15)));
    p.drain();
    expect(p.report.intents).toBe(4);
    expect(p.report.messagesDispatched).toBe(1);
    expect(p.report.superseded).toBe(3);
    expect(intents.slice(0, 3).every((i) => i.status === MessageStatus.SUPERSEDED)).toBe(true);
    expect(intents[3]!.status).toBe(MessageStatus.DELIVERED);
    expect(p.report.avoidedBaselineEstimate.toString()).toBe("0.12"); // 3 × demo utility rate 0.04 BRL
  });

  it("out-of-order arrival: an older update arriving late is superseded by the newer one", () => {
    const p = pipeline();
    const newer = p.submit(base({ eventType: "order.status", data: { status: "SHIPPED" }, occurredAt: at(30) }), at(0));
    const older = p.submit(base({ eventType: "order.status", data: { status: "PACKED" }, occurredAt: at(10) }), at(5));
    p.drain();
    expect(older.status).toBe(MessageStatus.SUPERSEDED);
    expect(newer.status).toBe(MessageStatus.DELIVERED);
  });

  it("baseline (no optimization) sends all four", () => {
    const p = pipeline(NO_FEATURES);
    ["A", "B", "C", "D"].forEach((s, i) => p.submit(base({ eventType: "order.status", data: { status: s } }), at(i * 15)));
    p.drain();
    expect(p.report.messagesDispatched).toBe(4);
  });
});

describe("Consent, opt-out and service window", () => {
  it("blocks templates without opt-in when required, and opted-out customers always", () => {
    const p = new InMemoryPipeline({ ...pipeline().cfg, requireOptIn: true });
    p.setConsent("cust-1", { optedIn: false });
    const a = p.submit(base(), at(0));
    expect(a.status).toBe(MessageStatus.BLOCKED);
    p.setConsent("cust-2", { optedIn: true, optedOut: true });
    const b = p.submit(base({ customerKey: "cust-2" }), at(1));
    expect(b.status).toBe(MessageStatus.BLOCKED);
  });

  it("blocks free-form (service) messages outside the customer service window", () => {
    const p = pipeline();
    const s = p.submit(base({ eventType: "support.reply", category: BillingCategory.SERVICE, freeFormText: "Olá" }), at(0));
    expect(s.status).toBe(MessageStatus.BLOCKED);
    expect(p.decisions[0]!.reasons).toContain("non_template_outside_customer_service_window");
  });

  it("sends free-form inside the window, consuming the free service quota (Oct-2026 policy)", () => {
    const p = pipeline();
    p.inbound("cust-1", "pn-1", at(0));
    p.submit(base({ eventType: "support.reply", category: BillingCategory.SERVICE, freeFormText: "Seu pedido saiu" }), at(60));
    p.drain();
    expect(p.report.free.quota).toBe(1);
    expect(p.report.realizedCost.toString()).toBe("0");
  });
});

describe("Schedule-aware sending inside a free entry point window", () => {
  it("pulls a deferrable follow-up into the open FEP window instead of after it closes", () => {
    const run = (features: OptimizationFeatures) => {
      const p = pipeline(features);
      p.inbound("cust-1", "pn-1", at(0), EntryPointType.CLICK_TO_WHATSAPP_AD);
      // First reply (free, opens FEP for 72h).
      p.submit(base({ eventType: "support.reply", category: BillingCategory.SERVICE, freeFormText: "Oi!", businessEntityId: "chat" }), at(60));
      // Marketing follow-up the business would send in 4 days, acceptable any time from now.
      p.submit(
        base({ eventType: "cart.reminder", businessEntityId: "cart-1", data: { items: "tênis" }, earliestSendAt: at(120), preferredSendAt: at(4 * 86400), maxDelaySeconds: 3600 }),
        at(120),
      );
      p.drain();
      return p.report;
    };
    const naive = run({ ...ALL_FEATURES, pricingOptimizer: false });
    const optimized = run(ALL_FEATURES);
    expect(naive.realizedCost.toString()).toBe("0.336");
    expect(optimized.realizedCost.toString()).toBe("0");
    expect(optimized.free.entryPoint).toBe(2);
  });
});

describe("PolicyEngine (declarative rules, spec §60)", () => {
  it("first matching rule wins; compound conditions", () => {
    const e = new PolicyEngine({ name: "t", rules: [{ when: { all: ["duplicate", { not: "critical" }] }, action: "SUPPRESS" }, { when: { fact: "priority", in: ["LOW"] }, action: "DELAY" }, { when: "x", action: "SEND_NOW" }] });
    expect(e.evaluate({ duplicate: true, critical: false }).action).toBe("SUPPRESS_DUPLICATE");
    expect(e.evaluate({ priority: "LOW" }).action).toBe("DELAY");
  });

  it("rejects invalid rule sets", () => {
    expect(() => PolicyEngine.validate({ name: "x", rules: [{ when: "a", action: "HACK" }] })).toThrow();
  });
});

describe("Category analyzer (advisory only)", () => {
  it("classifies deterministically and always defers to Meta", () => {
    expect(analyzeCategory("Seu pedido 123 foi enviado. Rastreio BR1").category).toBe("UTILITY");
    expect(analyzeCategory("Aproveite 20% off com o cupom VERAO").category).toBe("MARKETING");
    const mixed = analyzeCategory("Seu pedido foi enviado! Aproveite 10% de desconto na próxima compra");
    expect(mixed.category).toBe("MARKETING");
    expect(mixed.requiresHumanReview).toBe(true);
    expect(analyzeCategory("123456 é o seu código de verificação").category).toBe("AUTHENTICATION");
    expect(analyzeCategory("{{1}}").disclaimer).toBe("Final category is determined by Meta.");
  });
});

describe("Savings attribution and anomalies", () => {
  it("separates META, BSP and INFRASTRUCTURE savings", () => {
    const lines = attributeSavings({
      status: MessageStatus.SUPERSEDED,
      baselineCost: new Money("0.04"),
      optimizedCost: null,
      optimizedConfidence: "ESTIMATED",
      usesBsp: true,
      bspModel: { type: "FIXED_PER_MESSAGE", perMessage: "0.01" },
      infraCostPerProviderCall: new Money("0.00005"),
    });
    expect(lines.map((l) => `${l.kind}:${l.mechanism}:${l.savings.toString()}`)).toEqual([
      "META:SUPERSESSION:0.04",
      "BSP:BSP_MARKUP:0.01",
      "INFRASTRUCTURE:INFRASTRUCTURE:0.00005",
    ]);
  });

  it("never claims savings without a known baseline", () => {
    expect(attributeSavings({ status: MessageStatus.DEDUPLICATED, baselineCost: null, optimizedCost: null, optimizedConfidence: "UNKNOWN", usesBsp: false, infraCostPerProviderCall: new Money(0) })).toEqual([]);
  });

  it("flags daily cost 180% above the historical mean", () => {
    const r = detectCostAnomaly(Array.from({ length: 10 }, () => new Money(500)), new Money(1400));
    expect(r.anomalous).toBe(true);
    expect(r.message).toBe("Custo 180% acima da média.");
  });
});

// ------------------------------------------------------------------------------------------------
// Cost routing: template → free-form, FEP priority, inbound-first, deliverability, savings, splitter

const HOUR = 3600;
/** Templates whose own content can be shown as a free-form message. */
const CONVERTIBLE = DEMO_TEMPLATE_INFOS.map((t) => (["weekly_offer", "order_status_update", "otp_code"].includes(t.name) ? { ...t, freeFormConvertible: true } : t));
const policiesWith = (eventType: string, over: Partial<OptimizationPolicyConfig>): OptimizationPolicyConfig[] => DEFAULT_OPTIMIZATION_POLICIES.map((p) => (p.eventType === eventType ? { ...p, ...over } : p));

function routing(policies: OptimizationPolicyConfig[]) {
  return new InMemoryPipeline({ tenantId: "t1", timezone: "America/Sao_Paulo", currency: "BRL", engine, rules: new PolicyEngine(DEFAULT_RULESET), policies, templates: CONVERTIBLE, features: ALL_FEATURES, recordDecisions: true, explain: true });
}
const campaign = (over: Partial<IntentSubmission> = {}): IntentSubmission => base({ eventType: "marketing.campaign", businessEntityId: null, data: { offer: "10% off" }, ...over });

describe("Module 1 — template content as a free-form message inside the customer service window", () => {
  const optIn = policiesWith("marketing.campaign", { allowMarketingFreeFormInWindow: true });

  it("sends a MARKETING template's content as a service message while the window is open (opt-in policy)", () => {
    const p = routing(optIn);
    p.inbound("cust-1", "pn-1", at(0));
    const rec = p.submit(campaign(), at(60));
    const d = p.decisions[0]!;
    expect(d.action).toBe(DecisionAction.SEND_NOW);
    expect(d.messageKind).toBe(MessageKind.NON_TEMPLATE);
    expect(d.category).toBe(BillingCategory.SERVICE);
    expect(d.contentCategory).toBe(BillingCategory.MARKETING);
    expect(d.reasons).toEqual(expect.arrayContaining([RoutingReason.TEMPLATE_TO_FREEFORM_CSW, "free_form_service_message_cheaper_inside_window"]));
    // Exactly the template price is avoided: the service message is inside the free monthly allowance.
    expect(d.baselineCost!.category).toBe(BillingCategory.MARKETING);
    expect(d.estimatedSavings.toString()).toBe(d.baselineCost!.estimatedCost.toString());
    expect(d.estimatedSavings.isPositive()).toBe(true);
    expect(mechanismFromReasons(d.reasons)).toBe("TEMPLATE_TO_FREEFORM_CSW");
    // The template name is kept: the dispatcher renders the free-form message from it.
    expect(rec.templateName).toBe("weekly_offer");
    p.drain();
    expect(p.report.byCategory.SERVICE?.dispatched).toBe(1);
    expect(p.report.byCategory.MARKETING).toBeUndefined();
  });

  it("keeps the paid template when the policy did not opt in, the window is closed or the template is not convertible", () => {
    const off = routing(policiesWith("marketing.campaign", { allowMarketingFreeFormInWindow: false }));
    off.inbound("cust-1", "pn-1", at(0));
    off.submit(campaign(), at(60));
    expect(off.decisions[0]!.messageKind).toBe(MessageKind.TEMPLATE);

    const closed = routing(optIn);
    closed.submit(campaign(), at(60));
    expect(closed.decisions[0]!.messageKind).toBe(MessageKind.TEMPLATE);

    const notConvertible = new InMemoryPipeline({ tenantId: "t1", timezone: "America/Sao_Paulo", currency: "BRL", engine, rules: new PolicyEngine(DEFAULT_RULESET), policies: optIn, templates: DEMO_TEMPLATE_INFOS, features: ALL_FEATURES, recordDecisions: true });
    notConvertible.inbound("cust-1", "pn-1", at(0));
    notConvertible.submit(campaign(), at(60));
    expect(notConvertible.decisions[0]!.messageKind).toBe(MessageKind.TEMPLATE);
  });

  it("is built in: with the default policies the content goes as a conversation message inside the window", () => {
    const p = routing(DEFAULT_OPTIMIZATION_POLICIES);
    p.inbound("cust-1", "pn-1", at(0));
    p.submit(campaign(), at(60));
    expect(p.decisions[0]!.messageKind).toBe(MessageKind.NON_TEMPLATE);
  });

  it("never converts authentication, and marketing consent still decides", () => {
    const p = routing([...policiesWith("authentication.otp", { allowFreeFormInWindow: true, allowMarketingFreeFormInWindow: true })]);
    p.inbound("cust-1", "pn-1", at(0));
    p.submit(base({ eventType: "authentication.otp", businessEntityId: null, data: { code: "123456" } }), at(60));
    expect(p.decisions[0]!.messageKind).toBe(MessageKind.TEMPLATE);

    const optedOut = routing(optIn);
    optedOut.setConsent("cust-1", { marketingOptedOut: true });
    optedOut.inbound("cust-1", "pn-1", at(0));
    const blocked = optedOut.submit(campaign(), at(60));
    expect(blocked.status).toBe(MessageStatus.BLOCKED);
    expect(optedOut.decisions[0]!.rule.reason).toBe("marketing_opt_out");
  });

  it("flushing a buffered free-form message asks the dispatcher to render it from the template", () => {
    const p = routing(optIn);
    p.inbound("cust-1", "pn-1", at(0));
    const rec = p.submit(campaign(), at(60));
    const plan = planFlush([{ ...rec, status: MessageStatus.DELAYED }], { policyFor: () => optIn[0]!, templateFor: (n) => CONVERTIBLE.find((t) => t.name === n), features: ALL_FEATURES });
    expect(plan.messages[0]).toMatchObject({ messageKind: MessageKind.NON_TEMPLATE, templateName: null, text: null, renderFromTemplate: "weekly_offer", parameters: [{ name: "offer", value: "10% off" }] });
  });
});

describe("Module 3 — free entry point priority and inbound-first", () => {
  it("brings a later marketing message forward into the open free entry point window", () => {
    const p = routing(DEFAULT_OPTIMIZATION_POLICIES);
    p.inbound("cust-1", "pn-1", at(0), EntryPointType.CLICK_TO_WHATSAPP_AD);
    p.submit(base({ eventType: "support.reply", category: BillingCategory.SERVICE, freeFormText: "Oi!", businessEntityId: "chat" }), at(60)); // opens the 72 h window
    p.advance(at(120));
    // The campaign would go in 80 h (after the window closes) and be paid.
    p.submit(campaign({ preferredSendAt: at(80 * HOUR), maxDelaySeconds: 24 * HOUR }), at(180));
    const d = p.decisions[p.decisions.length - 1]!;
    expect(d.reasons).toEqual(expect.arrayContaining([RoutingReason.FEP_PRIORITY, "before_free_entry_point_window_closes"]));
    expect(d.cost!.isFree).toBe(true);
    expect(d.cost!.freeReason).toBe("free_entry_point_window");
    expect(d.sendAt!.getTime()).toBe(at(60 + 72 * HOUR - 120).getTime()); // window end minus the delivery safety margin
    expect(d.baselineCost!.isFree).toBe(false);
    expect(mechanismFromReasons(d.reasons)).toBe("FEP_PRIORITY");
    p.drain();
    expect(p.report.free.entryPoint).toBeGreaterThanOrEqual(2);
  });

  it("orders the dispatch queue: critical, high, free-entry-point window, then the rest", () => {
    expect(dispatchRank({ bypassBuffer: true, priority: Priority.LOW, freeEntryPointOpen: false })).toBe(0);
    expect(dispatchRank({ bypassBuffer: false, priority: Priority.HIGH, freeEntryPointOpen: false })).toBe(1);
    expect(dispatchRank({ bypassBuffer: false, priority: Priority.LOW, freeEntryPointOpen: true })).toBe(2);
    expect(dispatchRank({ bypassBuffer: false, priority: Priority.NORMAL, freeEntryPointOpen: false })).toBe(3);
    expect(dispatchRank({ bypassBuffer: false, priority: Priority.LOW, freeEntryPointOpen: false })).toBe(4);
  });

  const inboundFirst = policiesWith("marketing.campaign", { allowMarketingFreeFormInWindow: true, inboundFirstGraceMinutes: 30 });

  it("holds a paid template for the grace; if the customer writes, the same content goes as a service message", () => {
    const p = routing(inboundFirst);
    const rec = p.submit(campaign(), at(0));
    const d = p.decisions[0]!;
    expect(d.action).toBe(DecisionAction.DELAY);
    expect(d.wakeUp).toBe(true);
    expect(d.reasons).toContain(RoutingReason.INBOUND_FIRST_WAIT);
    expect(d.sendAt!.getTime()).toBe(at(30 * 60).getTime());
    expect(d.messageKind).toBe(MessageKind.TEMPLATE); // what goes out if nobody writes
    expect(p.report.inboundWakeUps).toBe(1);
    p.inbound("cust-1", "pn-1", at(10 * 60));
    p.advance(at(11 * 60));
    expect(rec.status).toBe(MessageStatus.DELIVERED);
    expect(rec.sentAt!.getTime()).toBe(at(10 * 60).getTime());
    expect(rec.messageKind).toBe(MessageKind.NON_TEMPLATE);
    expect(rec.contentCategory).toBe(BillingCategory.MARKETING);
    expect(p.report.inboundFirstConverted).toBe(1);
    p.drain();
    expect(p.report.byCategory.SERVICE?.dispatched).toBe(1);
    expect(p.report.byCategory.MARKETING).toBeUndefined();
  });

  it("sends the template at the end of the grace when nobody writes, and never waits past the deadline", () => {
    const p = routing(inboundFirst);
    const rec = p.submit(campaign(), at(0));
    p.advance(at(29 * 60));
    expect(rec.status).toBe(MessageStatus.DELAYED);
    p.drain();
    expect(rec.messageKind).toBe(MessageKind.TEMPLATE);
    expect(p.report.byCategory.MARKETING?.dispatched).toBe(1);

    const short = routing(inboundFirst);
    short.submit(campaign({ maxDelaySeconds: 5 * 60 }), at(0));
    expect(short.decisions[0]!.sendAt!.getTime()).toBe(at(5 * 60).getTime());
    const none = routing(inboundFirst);
    none.submit(campaign({ maxDelaySeconds: 0 }), at(0));
    expect(none.decisions[0]!.action).toBe(DecisionAction.SEND_NOW);
    expect(none.decisions[0]!.wakeUp).toBe(false);
  });

  it("never holds critical or immediate messages, nor templates with no free-form alternative", () => {
    const p = routing(policiesWith("critical.security", { allowFreeFormInWindow: true, inboundFirstGraceMinutes: 30 }));
    p.submit(base({ eventType: "critical.security", businessEntityId: null, data: { event: "login" } }), at(0));
    expect(p.decisions[0]!.action).toBe(DecisionAction.SEND_NOW);
    const immediate = routing(inboundFirst);
    immediate.submit(campaign({ mustSendImmediately: true }), at(0));
    expect(immediate.decisions[0]).toMatchObject({ action: DecisionAction.SEND_NOW, wakeUp: false });
    const noAlternative = routing(policiesWith("marketing.campaign", { inboundFirstGraceMinutes: 30, allowMarketingFreeFormInWindow: false }));
    noAlternative.submit(campaign(), at(0));
    expect(noAlternative.decisions[0]).toMatchObject({ action: DecisionAction.SEND_NOW, wakeUp: false });
  });
});

describe("Module 5 — what Meta reported about the recipient (131026 / 131049)", () => {
  it("does not call the API again for a number Meta just reported as undeliverable", () => {
    const p = routing(DEFAULT_OPTIMIZATION_POLICIES);
    p.setDeliverability("cust-1", { undeliverableUntil: at(24 * HOUR) });
    const rec = p.submit(campaign(), at(0));
    expect(rec.status).toBe(MessageStatus.BLOCKED);
    expect(p.decisions[0]!.rule).toMatchObject({ action: DecisionAction.BLOCK, reason: RoutingReason.SUPPRESSED_INVALID_RECIPIENT });
    expect(p.decisions[0]!.explanation.join(" ")).toContain("131026");
    p.drain();
    expect(p.report.messagesDispatched).toBe(0);
  });

  it("still attempts OTP and critical messages, and anything once the entry expired or the customer wrote", () => {
    const p = routing(DEFAULT_OPTIMIZATION_POLICIES);
    p.setDeliverability("cust-1", { undeliverableUntil: at(24 * HOUR) });
    const otp = p.submit(base({ eventType: "authentication.otp", businessEntityId: null, data: { code: "1" } }), at(0));
    const alert = p.submit(base({ eventType: "fraud.alert", businessEntityId: null, data: { amount: "R$ 1", merchant: "x" } }), at(1));
    expect([otp.status, alert.status]).not.toContain(MessageStatus.BLOCKED);
    const later = p.submit(campaign({ data: { offer: "depois" } }), at(25 * HOUR));
    expect(later.status).not.toBe(MessageStatus.BLOCKED);

    const wrote = routing(DEFAULT_OPTIMIZATION_POLICIES);
    wrote.setDeliverability("cust-1", { undeliverableUntil: at(24 * HOUR) });
    wrote.inbound("cust-1", "pn-1", at(10));
    expect(wrote.submit(campaign(), at(20)).status).not.toBe(MessageStatus.BLOCKED);
  });

  it("defers a marketing template until the per-user limit cooldown ends, never past its deadline", () => {
    const p = routing(DEFAULT_OPTIMIZATION_POLICIES);
    p.setDeliverability("cust-1", { marketingCapUntil: at(12 * HOUR) });
    const rec = p.submit(campaign(), at(0)); // marketing.campaign may wait up to 24 h
    const d = p.decisions[0]!;
    expect(d.action).toBe(DecisionAction.DELAY);
    expect(d.reasons).toContain(RoutingReason.DEFERRED_FREQUENCY_CAP);
    expect(d.sendAt!.getTime()).toBe(at(12 * HOUR).getTime());
    expect(d.facts.marketingFrequencyCapped).toBe(true);
    p.advance(at(11 * HOUR));
    expect(rec.status).toBe(MessageStatus.DELAYED);
    p.drain();
    expect(rec.sentAt!.getTime()).toBe(at(12 * HOUR).getTime());

    const beyond = routing(DEFAULT_OPTIMIZATION_POLICIES);
    beyond.setDeliverability("cust-1", { marketingCapUntil: at(48 * HOUR) });
    beyond.submit(campaign(), at(0));
    expect(beyond.decisions[0]!.sendAt!.getTime()).toBe(at(24 * HOUR).getTime()); // the deadline wins
  });

  it("lets utility and authentication through during a marketing cooldown", () => {
    const p = routing(DEFAULT_OPTIMIZATION_POLICIES);
    p.setDeliverability("cust-1", { marketingCapUntil: at(12 * HOUR) });
    p.submit(base({ eventType: "appointment.reminder", businessEntityId: null, data: { date: "amanhã", time: "10h" } }), at(0));
    p.submit(base({ eventType: "authentication.otp", businessEntityId: null, data: { code: "1" } }), at(1));
    expect(p.decisions.map((d) => d.action)).toEqual([DecisionAction.SEND_NOW, DecisionAction.SEND_NOW]);
    expect(p.decisions.every((d) => !d.reasons.includes(RoutingReason.DEFERRED_FREQUENCY_CAP))).toBe(true);
  });
});

describe("Savings attribution for the cost-routing features", () => {
  const cents = (v: string) => new Money(v);
  const common = { usesBsp: false, infraCostPerProviderCall: cents("0.0001"), optimizedConfidence: "ESTIMATED" as const };

  it("names the mechanism from the decision reasons", () => {
    expect(mechanismFromReasons("no_optimization_applicable,utility_split_deferred")).toBe("UTILITY_SPLIT_DEFERRED");
    expect(mechanismFromReasons([RoutingReason.INBOUND_FIRST_WAIT, RoutingReason.INBOUND_FIRST_CONVERTED])).toBe("TEMPLATE_TO_FREEFORM_CSW");
    expect(mechanismFromReasons("free_form_service_message_cheaper_inside_window")).toBe("CATEGORY");
    expect(mechanismFromReasons("send_now")).toBeNull();
    const line = attributeSavings({ ...common, status: MessageStatus.DELIVERED, baselineCost: cents("0.059"), optimizedCost: cents("0"), freeReason: "free_monthly_quota", mechanismHint: "TEMPLATE_TO_FREEFORM_CSW" });
    expect(line).toEqual([expect.objectContaining({ kind: "META", mechanism: "TEMPLATE_TO_FREEFORM_CSW", savings: cents("0.059") })]);
  });

  it("credits FEP priority only when the message really went free inside the entry point window", () => {
    const free = attributeSavings({ ...common, status: MessageStatus.DELIVERED, baselineCost: cents("0.059"), optimizedCost: cents("0"), freeReason: "free_entry_point_window", mechanismHint: "FEP_PRIORITY" });
    expect(free[0]!.mechanism).toBe("FEP_PRIORITY");
    const paid = attributeSavings({ ...common, status: MessageStatus.DELIVERED, baselineCost: cents("0.059"), optimizedCost: cents("0.05"), freeReason: null, mechanismHint: "FEP_PRIORITY" });
    expect(paid[0]!.mechanism).toBe("NONE");
  });

  it("BSP_MARKUP_AVOIDED: the legacy BSP's fee per message, kept apart from Meta savings", () => {
    const legacyBspModel = { type: "MIXED" as const, percentOfMeta: "10", perMessage: "0.01" };
    const sent = attributeSavings({ ...common, legacyBspModel, status: MessageStatus.DELIVERED, baselineCost: cents("0.05"), optimizedCost: cents("0.05") });
    expect(sent).toEqual([expect.objectContaining({ kind: "BSP", mechanism: "BSP_MARKUP_AVOIDED", savings: cents("0.015"), confidence: "ESTIMATED" })]);
    const avoided = attributeSavings({ ...common, legacyBspModel, status: MessageStatus.DEDUPLICATED, baselineCost: cents("0.05"), optimizedCost: null });
    expect(avoided.map((l) => `${l.kind}:${l.mechanism}`)).toEqual(["META:DEDUPLICATION", "BSP:BSP_MARKUP_AVOIDED", "INFRASTRUCTURE:INFRASTRUCTURE"]);
    // A tenant that still sends through a BSP does not avoid its fee on sent messages.
    expect(attributeSavings({ ...common, usesBsp: true, bspModel: legacyBspModel, legacyBspModel, status: MessageStatus.DELIVERED, baselineCost: cents("0.05"), optimizedCost: cents("0.05") })).toEqual([]);
  });

  it("recipient-level suppression and deferral only ever save a provider call, never Meta cost", () => {
    const suppressed = attributeSavings({ ...common, status: MessageStatus.BLOCKED, baselineCost: cents("0.059"), optimizedCost: null, suppressedInvalidRecipient: true });
    expect(suppressed).toEqual([expect.objectContaining({ kind: "INFRASTRUCTURE", mechanism: "INVALID_RECIPIENT_SUPPRESSED", savings: cents("0.0001") })]);
    const deferred = attributeSavings({ ...common, status: MessageStatus.DELAYED, baselineCost: null, optimizedCost: null, deferredFrequencyCap: true });
    expect(deferred).toEqual([expect.objectContaining({ kind: "INFRASTRUCTURE", mechanism: "FREQUENCY_CAP_DEFERRED" })]);
  });
});

describe("Module 2 — template compliance splitter (advisory)", () => {
  const splitter = new TemplateComplianceSplitter();

  it("takes whole promotional sentences out of a transactional text, without rewording anything", () => {
    const r = splitter.split("Seu pedido {{1}} foi enviado. Rastreio: {{2}}.\nAproveite 10% de desconto na próxima compra com o cupom VOLTA10!");
    expect(r.transactional).toBe("Seu pedido {{1}} foi enviado. Rastreio: {{2}}.");
    expect(r.promotional).toBe("Aproveite 10% de desconto na próxima compra com o cupom VOLTA10!");
    expect(r.removed[0]!.signals).toEqual(expect.arrayContaining(["desconto", "cupom"]));
    expect(r).toMatchObject({ changed: true, looksUtility: true, rewriter: "rules", mixed: [], disclaimer: "Final category is determined by Meta." });
    expect(r.analysis.category).toBe("UTILITY");
  });

  it("leaves clean transactional texts alone and never passes a promotion off as utility", () => {
    const clean = splitter.split("Seu pagamento do pedido {{1}} foi confirmado.");
    expect(clean).toMatchObject({ changed: false, promotional: null, looksUtility: true });
    const promo = splitter.split("Oferta da semana: {{1}}. Aproveite!");
    expect(promo.transactional).toBe("");
    expect(promo.looksUtility).toBe(false);
    expect(promo.notes.join(" ")).toContain("marketing template");
  });

  it("flags sentences that mix both and only accepts a rewriter's text that passes the same rules", async () => {
    const mixedText = "Seu pedido {{1}} foi enviado e você ganhou um cupom de 10% de desconto.";
    const rules = splitter.split(mixedText);
    expect(rules.mixed).toHaveLength(1);
    expect(rules).toMatchObject({ changed: false, looksUtility: false });

    const good = new TemplateComplianceSplitter({ rewriter: { name: "fake-llm", rewrite: async () => ({ transactional: "Seu pedido {{1}} foi enviado.", promotional: "Você ganhou um cupom de 10% de desconto." }) } });
    expect(await good.splitWithRewriter(mixedText)).toMatchObject({ transactional: "Seu pedido {{1}} foi enviado.", promotional: "Você ganhou um cupom de 10% de desconto.", looksUtility: true, rewriter: "fake-llm" });

    const bad = new TemplateComplianceSplitter({ rewriter: { name: "sloppy", rewrite: async () => ({ transactional: "Pedido enviado — aproveite a oferta!", promotional: null }) } });
    const kept = await bad.splitWithRewriter(mixedText);
    expect(kept.rewriter).toBe("rules");
    expect(kept.notes.join(" ")).toContain("discarded");
  });

  it("HttpPromotionalRewriter posts the texts to the configured endpoint", async () => {
    let seen: { url: string; auth: string | null; body: unknown } | null = null;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      seen = { url: String(url), auth: new Headers(init?.headers).get("authorization"), body: JSON.parse(String(init?.body)) };
      return new Response(JSON.stringify({ transactional: "Pedido enviado.", promotional: "Cupom!" }), { status: 200 });
    }) as typeof fetch;
    const rw = new HttpPromotionalRewriter({ url: "https://rewriter.example/split", authorization: "Bearer k", fetchImpl });
    expect(await rw.rewrite({ original: "o", transactional: "t", promotional: null })).toEqual({ transactional: "Pedido enviado.", promotional: "Cupom!" });
    expect(seen).toEqual({ url: "https://rewriter.example/split", auth: "Bearer k", body: { original: "o", transactional: "t", promotional: null } });
  });
});
