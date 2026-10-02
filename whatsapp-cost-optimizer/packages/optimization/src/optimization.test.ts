import { describe, expect, it } from "vitest";
import { BillingCategory, EntryPointType, MessageKind, MessageStatus, Money, Priority } from "@wco/domain";
import { BUILTIN_POLICIES, CostEngine, PolicyRegistry, demoRateCatalog } from "@wco/pricing";
import { DEFAULT_OPTIMIZATION_POLICIES, DEFAULT_RULESET, PolicyEngine, type OptimizationPolicyConfig } from "@wco/policy";
import {
  ALL_FEATURES,
  DEMO_TEMPLATE_INFOS,
  InMemoryPipeline,
  NO_FEATURES,
  analyzeCategory,
  attributeSavings,
  detectCostAnomaly,
  planFlush,
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
