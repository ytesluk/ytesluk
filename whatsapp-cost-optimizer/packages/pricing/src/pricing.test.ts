import { describe, expect, it } from "vitest";
import {
  BillingCategory,
  EntryPointType,
  MessageKind,
  Money,
  PricingStatus,
  VerificationStatus,
  resolveMarket,
  type ConversationContext,
} from "@wco/domain";
import {
  CostEngine,
  PolicyRegistry,
  BUILTIN_POLICIES,
  TierCalculator,
  demoRateCatalog,
  importCsv,
  importJson,
  simulateRateCard,
  compareDirectVsBsp,
  type PricingContext,
} from "./index";

const TZ = "America/Sao_Paulo";
const BR = "+5511999990000";
const engine = new CostEngine(new PolicyRegistry(BUILTIN_POLICIES), demoRateCatalog());

const noWindows: ConversationContext = { customerServiceWindow: { lastInboundAt: null }, freeEntryPoint: null };

function ctx(over: Partial<PricingContext> & { at: Date }): PricingContext & { currency: string } {
  return {
    category: BillingCategory.MARKETING,
    messageKind: MessageKind.TEMPLATE,
    timezone: TZ,
    recipient: BR,
    businessPhoneNumberId: "pn-1",
    conversation: noWindows,
    currency: "BRL",
    ...over,
  };
}

describe("TierCalculator (spec §5 volume tiers)", () => {
  const calc = new TierCalculator([
    { start: 1, end: 10_000, rate: new Money("0.04") },
    { start: 10_001, end: 25_000, rate: new Money("0.038") },
    { start: 25_001, end: 100_000, rate: new Money("0.036") },
    { start: 100_001, end: null, rate: new Money("0.033") },
  ]);

  it("distributes messages across tiers (marginal pricing)", () => {
    const { total, slices } = calc.cost(0, 30_000);
    // 10,000 × 0.04 + 15,000 × 0.038 + 5,000 × 0.036
    expect(total.toString()).toBe("1150");
    expect(slices.map((s) => s.count)).toEqual([10_000, 15_000, 5_000]);
    // NOT "all messages at the highest tier reached"
    expect(total.equals(new Money("0.036").times(30_000))).toBe(false);
  });

  it("continues from the current position in the month", () => {
    expect(calc.cost(9_000, 2_000).total.toString()).toBe("78");
    expect(calc.rateAt(10_000).toString()).toBe("0.04");
    expect(calc.rateAt(10_001).toString()).toBe("0.038");
    expect(calc.rateAt(5_000_000).toString()).toBe("0.033");
  });

  it("rejects gaps and overlaps", () => {
    expect(() => new TierCalculator([{ start: 1, end: 10, rate: new Money(1) }, { start: 12, end: null, rate: new Money(1) }])).toThrow();
    expect(() => new TierCalculator([{ start: 2, end: null, rate: new Money(1) }])).toThrow();
  });
});

describe("market resolution (recipient calling code, versioned)", () => {
  it("resolves standalone markets and regions", () => {
    expect(resolveMarket("+5511999990000", "2026-10-02").market).toBe("BR");
    expect(resolveMarket("+14155550100", "2026-10-02").market).toBe("NORTH_AMERICA");
    expect(resolveMarket("+18095550100", "2026-10-02").market).toBe("REST_OF_LATIN_AMERICA");
    expect(resolveMarket("+12425550100", "2026-10-02").market).toBe("OTHER");
    expect(resolveMarket("+351912345678", "2026-10-02").market).toBe("REST_OF_WESTERN_EUROPE");
    expect(resolveMarket("+9607771234", "2026-10-02").market).toBe("OTHER");
  });

  it("applies market moves on their effective date", () => {
    expect(resolveMarket("+380501234567", "2026-09-30").market).toBe("REST_OF_CENTRAL_EASTERN_EUROPE");
    expect(resolveMarket("+380501234567", "2026-10-01").market).toBe("UA");
    expect(resolveMarket("+77011234567", "2026-09-30").market).toBe("RU");
    expect(resolveMarket("+77011234567", "2026-10-01").market).toBe("KZ");
    expect(resolveMarket("+48501234567", "2026-06-30").market).toBe("REST_OF_CENTRAL_EASTERN_EUROPE");
    expect(resolveMarket("+48501234567", "2026-07-01").market).toBe("PL");
  });
});

describe("Free entry point (spec §41 cases 5 and 6)", () => {
  const userMessageAt = new Date("2026-10-05T12:00:00Z");
  const pending: ConversationContext = {
    customerServiceWindow: { lastInboundAt: userMessageAt },
    freeEntryPoint: {
      type: EntryPointType.CLICK_TO_WHATSAPP_AD,
      userMessageAt,
      firstBusinessReplyAt: null,
      windowStartedAt: null,
      confirmedExpiresAt: null,
      verification: VerificationStatus.ESTIMATED,
    },
  };

  it("case 5: first reply within 24h is free and opens the FEP window (policy-versioned)", () => {
    const r = engine.evaluate(ctx({ at: new Date("2026-10-05T14:00:00Z"), conversation: pending }));
    expect(r.status).toBe(PricingStatus.FREE);
    expect(r.freeReason).toBe("free_entry_point_window");
    expect(r.windows.freeEntryPoint.opensOnThisMessage).toBe(true);
    expect(r.policyVersion).toBe("meta-pmp-2026-10");

    const open: ConversationContext = {
      ...pending,
      freeEntryPoint: { ...pending.freeEntryPoint!, firstBusinessReplyAt: new Date("2026-10-05T14:00:00Z"), windowStartedAt: new Date("2026-10-05T14:00:00Z") },
    };
    // Marketing template 48h later: still inside the 72h window (and CSW already closed).
    const later = engine.evaluate(ctx({ at: new Date("2026-10-07T14:00:00Z"), conversation: open }));
    expect(later.status).toBe(PricingStatus.FREE);
    expect(later.windows.customerServiceWindow.open).toBe(false);
  });

  it("case 6: expired FEP window is not free", () => {
    const open: ConversationContext = {
      ...pending,
      freeEntryPoint: { ...pending.freeEntryPoint!, firstBusinessReplyAt: new Date("2026-10-05T14:00:00Z"), windowStartedAt: new Date("2026-10-05T14:00:00Z") },
    };
    const r = engine.evaluate(ctx({ at: new Date("2026-10-08T14:00:01Z"), conversation: open }));
    expect(r.status).toBe(PricingStatus.PAID);
    expect(r.rate?.toString()).toBe("0.336");
  });

  it("a reply after 24h does not open a FEP window", () => {
    const r = engine.evaluate(ctx({ at: new Date("2026-10-06T12:00:01Z"), conversation: pending }));
    expect(r.status).toBe(PricingStatus.PAID);
    expect(r.windows.freeEntryPoint.eligibleForFreeReply).toBe(false);
  });

  it("a FEP rejected by Meta (e.g. desktop click) is never free", () => {
    const rejected: ConversationContext = { ...pending, freeEntryPoint: { ...pending.freeEntryPoint!, verification: VerificationStatus.REJECTED } };
    expect(engine.evaluate(ctx({ at: new Date("2026-10-05T14:00:00Z"), conversation: rejected })).status).toBe(PricingStatus.PAID);
  });

  it("Meta-confirmed expiry overrides the local 72h estimate", () => {
    const confirmed: ConversationContext = {
      ...pending,
      freeEntryPoint: {
        ...pending.freeEntryPoint!,
        windowStartedAt: new Date("2026-10-05T14:00:00Z"),
        confirmedExpiresAt: new Date("2026-10-06T14:00:00Z"),
        verification: VerificationStatus.CONFIRMED,
      },
    };
    expect(engine.evaluate(ctx({ at: new Date("2026-10-07T00:00:00Z"), conversation: confirmed })).status).toBe(PricingStatus.PAID);
  });
});

describe("Service free quota (spec §41 case 7)", () => {
  const inWindow: ConversationContext = { customerServiceWindow: { lastInboundAt: new Date("2026-10-10T10:00:00Z") }, freeEntryPoint: null };
  const service = (quotaUsed: number) =>
    engine.evaluate(ctx({ at: new Date("2026-10-10T11:00:00Z"), category: BillingCategory.SERVICE, messageKind: MessageKind.NON_TEMPLATE, conversation: inWindow, quotaUsed }));

  it("uses the 1,000/phone-number monthly quota first", () => {
    const r = service(999);
    expect(r.status).toBe(PricingStatus.QUOTA);
    expect(r.quota).toMatchObject({ scope: "PHONE_NUMBER", scopeKey: "pn-1", periodKey: "2026-10", amount: 1000, usedBefore: 999 });
  });

  it("charges the rate card rate once the quota is exhausted", () => {
    const r = service(1000);
    expect(r.status).toBe(PricingStatus.PAID);
    expect(r.rate?.toString()).toBe("0.04");
    expect(r.countsTowardTier).toBe(false); // no tiers for service
  });

  it("service is not eligible outside the customer service window", () => {
    const r = engine.evaluate(ctx({ at: new Date("2026-10-12T11:00:00Z"), category: BillingCategory.SERVICE, messageKind: MessageKind.NON_TEMPLATE, conversation: inWindow }));
    expect(r.status).toBe(PricingStatus.NOT_ELIGIBLE);
  });

  it("service was free under the previous policy (no quota needed)", () => {
    const old: ConversationContext = { customerServiceWindow: { lastInboundAt: new Date("2026-09-10T10:00:00Z") }, freeEntryPoint: null };
    const r = engine.evaluate(ctx({ at: new Date("2026-09-10T11:00:00Z"), category: BillingCategory.SERVICE, messageKind: MessageKind.NON_TEMPLATE, conversation: old }));
    expect(r.status).toBe(PricingStatus.FREE);
    expect(r.policyVersion).toBe("meta-pmp-2025-07");
  });
});

describe("Policy versioning and WABA timezone (spec §86, §87)", () => {
  // 2026-10-01T02:30Z is 2026-09-30 23:30 in São Paulo (UTC-3): old policy still applies.
  const lastInbound = new Date("2026-09-30T20:00:00Z");
  const conv: ConversationContext = { customerServiceWindow: { lastInboundAt: lastInbound }, freeEntryPoint: null };

  it("utility inside CSW is free until 2026-09-30 (WABA local date)", () => {
    const r = engine.evaluate(ctx({ at: new Date("2026-10-01T02:30:00Z"), category: BillingCategory.UTILITY, conversation: conv }));
    expect(r.billingDate).toBe("2026-09-30");
    expect(r.status).toBe(PricingStatus.FREE);
    expect(r.freeReason).toBe("customer_service_window");
    expect(r.policyVersion).toBe("meta-pmp-2025-07");
  });

  it("utility inside CSW is charged from 2026-10-01 (WABA local date)", () => {
    const r = engine.evaluate(ctx({ at: new Date("2026-10-01T03:30:00Z"), category: BillingCategory.UTILITY, conversation: conv }));
    expect(r.billingDate).toBe("2026-10-01");
    expect(r.status).toBe(PricingStatus.PAID);
    expect(r.policyVersion).toBe("meta-pmp-2026-10");
  });

  it("same instant, different WABA timezone → different policy", () => {
    const r = engine.evaluate(ctx({ at: new Date("2026-10-01T02:30:00Z"), timezone: "UTC", category: BillingCategory.UTILITY, conversation: conv }));
    expect(r.policyVersion).toBe("meta-pmp-2026-10");
  });

  it("volume tier position changes the utility rate (spec §41 case 8)", () => {
    const r1 = engine.evaluate(ctx({ at: new Date("2026-10-15T12:00:00Z"), category: BillingCategory.UTILITY, tierPosition: 9_999 }));
    const r2 = engine.evaluate(ctx({ at: new Date("2026-10-15T12:00:00Z"), category: BillingCategory.UTILITY, tierPosition: 10_000 }));
    expect(r1.rate?.toString()).toBe("0.04");
    expect(r2.rate?.toString()).toBe("0.038");
    expect(r2.tier?.index).toBe(1);
    expect(r2.countsTowardTier).toBe(true);
  });

  it("returns UNKNOWN (never free/paid) without a policy or a rate card", () => {
    expect(engine.evaluate(ctx({ at: new Date("2025-01-10T12:00:00Z") })).status).toBe(PricingStatus.UNKNOWN);
    expect(engine.evaluate({ ...ctx({ at: new Date("2026-10-10T12:00:00Z") }), currency: "JPY" }).status).toBe(PricingStatus.UNKNOWN);
  });

  it("authentication-international applies only when eligible and priced", () => {
    const eu = "+33612345678";
    const normal = engine.evaluate(ctx({ at: new Date("2026-10-10T12:00:00Z"), recipient: eu, category: BillingCategory.AUTHENTICATION }));
    const intl = engine.evaluate(ctx({ at: new Date("2026-10-10T12:00:00Z"), recipient: eu, category: BillingCategory.AUTHENTICATION, authInternationalEligible: true }));
    expect(normal.category).toBe("AUTHENTICATION");
    expect(intl.category).toBe("AUTHENTICATION_INTERNATIONAL");
    expect(intl.rate?.toString()).toBe("0.3");
  });
});

describe("Pricing regression snapshot (spec §86)", () => {
  it("evaluation matrix is stable for every policy version", () => {
    const at = [new Date("2026-08-15T15:00:00Z"), new Date("2026-10-15T15:00:00Z")];
    const csw: ConversationContext = { customerServiceWindow: { lastInboundAt: new Date(0) }, freeEntryPoint: null };
    const matrix: Record<string, string> = {};
    for (const t of at) {
      const inWindow: ConversationContext = { customerServiceWindow: { lastInboundAt: new Date(t.getTime() - 3_600_000) }, freeEntryPoint: null };
      for (const category of [BillingCategory.MARKETING, BillingCategory.UTILITY, BillingCategory.AUTHENTICATION, BillingCategory.SERVICE]) {
        for (const [label, conv] of [["no-window", csw], ["in-csw", inWindow]] as const) {
          for (const recipient of ["+5511999990000", "+14155550100", "+4915112345678", "+2348031234567"]) {
            const r = engine.evaluate(
              ctx({
                at: t,
                category,
                messageKind: category === BillingCategory.SERVICE ? MessageKind.NON_TEMPLATE : MessageKind.TEMPLATE,
                conversation: conv,
                recipient,
                quotaUsed: 5000,
              }),
            );
            matrix[`${t.toISOString().slice(0, 10)}|${category}|${label}|${recipient.slice(0, 4)}`] =
              `${r.status}|${r.rate?.toString() ?? "-"}|${r.policyVersion}|${r.market}`;
          }
        }
      }
    }
    expect(matrix).toMatchSnapshot();
  });
});

describe("Rate card importer (spec §15)", () => {
  it("imports a JSON rate card with tiers", () => {
    const r = importJson(
      JSON.stringify({
        name: "Test BRL",
        currency: "BRL",
        effectiveFrom: "2026-10-01",
        sourceUrl: "https://example.org/rates",
        sourceDocument: "test",
        rates: [
          { market: "Brazil", category: "utility", tierStart: 1, tierEnd: 100, unitRate: "0.05" },
          { market: "Brazil", category: "utility", tierStart: 101, tierEnd: null, unitRate: "0.04" },
          { market: "North America", category: "Marketing", unitRate: 0.1 },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.rows.map((x) => x.market)).toEqual(["BR", "BR", "NORTH_AMERICA"]);
    expect(r.tiers).toHaveLength(2);
  });

  it("imports wide CSV list rates plus a long tiers CSV", () => {
    const wide = "Market,Currency,Marketing,Utility,Authentication,Authentication-International,Service\nBrazil,USD,0.0700,0.0080,0.0080,,0.0080\nOther,USD,0.0600,0.0077,0.0077,,0.0077\n";
    const tiers = "market,category,tier_start,tier_end,unit_rate\nBrazil,UTILITY,1,1000,0.0080\nBrazil,UTILITY,1001,,0.0070\n";
    const r = importCsv(wide, { name: "Wide", effectiveFrom: "2026-10-01", sourceUrl: "https://x", sourceDocument: "x.csv" }, tiers);
    expect(r.issues).toEqual([]);
    expect(r.format).toBe("csv-wide");
    const brUtility = r.rows.filter((x) => x.market === "BR" && x.category === "UTILITY");
    expect(brUtility).toHaveLength(2);
    expect(r.card?.meta.currency).toBe("USD");
  });

  it("fails loudly on invalid tiers and unknown categories", () => {
    const csv = "market,currency,category,tier_start,tier_end,unit_rate\nBR,BRL,UTILITY,1,100,0.05\nBR,BRL,UTILITY,150,,0.04\nBR,BRL,BOGUS,1,,0.1\n";
    const r = importCsv(csv, { name: "Bad", effectiveFrom: "2026-10-01", sourceUrl: "https://x", sourceDocument: "x" });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.message.includes("contiguous"))).toBe(true);
    expect(r.issues.some((i) => i.message.includes("BOGUS"))).toBe(true);
  });
});

describe("Simulators", () => {
  it("rate card simulator separates Meta, BSP and infrastructure", () => {
    const r = simulateRateCard(
      {
        date: "2026-10-15",
        market: "BR",
        currency: "BRL",
        category: BillingCategory.UTILITY,
        monthlyMessages: 50_000,
        deliveryRate: 1,
        fepPercent: 0,
        serviceWindowPercent: 0,
        bsp: { type: "FIXED_PER_MESSAGE", perMessage: "0.005" },
        infraFeePerMessage: "0.0001",
        optimizationReductionPercent: 20,
      },
      new PolicyRegistry(BUILTIN_POLICIES),
      demoRateCatalog(),
    );
    // 10,000×0.04 + 15,000×0.038 + 25,000×0.036 = 400 + 570 + 900
    expect(r.baseline.metaCost).toBe("1870.0000");
    expect(r.optimized.messagesSent).toBe(40_000);
    expect(r.label).toBe("ESTIMATED");
    expect(r.isDemoRate).toBe(true);
    expect(Number(r.savings.bsp)).toBeCloseTo(50, 6);
  });

  it("BSP comparison handles 'no markup' honestly", () => {
    const r = compareDirectVsBsp({ currency: "BRL", metaMonthlyCost: "1000", monthlyMessages: 10_000, bsp: { type: "NONE" } });
    expect(r.difference.cheaper).toBe("EQUAL");
  });
});
