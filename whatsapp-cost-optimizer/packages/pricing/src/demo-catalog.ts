import { BillingCategory as C, Money, Region, sha256Hex } from "@wco/domain";
import { RateCard, RateCatalog } from "./rate-card";
import type { RateCardMeta, RateRow } from "./types";

/**
 * ███ DEMO RATES — NOT META RATES ███
 *
 * Fictitious values for development, tests and the academic simulator (spec §91). They are
 * deliberately round/synthetic and must never be presented as Meta's prices. Real rate cards are
 * imported by an administrator (`pnpm pricing import`) from Meta's official files.
 *
 * Demo markets: BR, US (covers Meta's NORTH_AMERICA market), EU (a DEMO-only grouping of European
 * markets — Meta has no "EU" market, see KNOWN-CONFLICTS C8) and OTHER.
 */
export const DEMO_SOURCE_URL = "demo://wco/fictitious-rate-card";
export const DEMO_DOCUMENT = "DEMO — valores fictícios para testes, NÃO são tarifas da Meta";

export const DEMO_MARKET_ALIASES: Record<string, string[]> = {
  US: [Region.NORTH_AMERICA],
  EU: ["FR", "DE", "IT", "ES", "NL", "PL", "HU", "RO", Region.REST_OF_WESTERN_EUROPE, Region.REST_OF_CENTRAL_EASTERN_EUROPE],
};

/** Demo volume tiers (small on purpose so simulations of 100k events cross tiers). */
export const DEMO_TIER_BOUNDS: Array<[number, number | null]> = [
  [1, 10_000],
  [10_001, 25_000],
  [25_001, 100_000],
  [100_001, null],
];

type MarketSpec = {
  marketing: string;
  utility: [string, string, string, string];
  authentication: [string, string, string, string];
  authenticationInternational?: [string, string, string, string];
};

const BRL_2025: Record<string, MarketSpec> = {
  BR: { marketing: "0.32000000", utility: ["0.04000000", "0.03800000", "0.03600000", "0.03300000"], authentication: ["0.04000000", "0.03800000", "0.03600000", "0.03300000"] },
  US: { marketing: "0.13500000", utility: ["0.02000000", "0.01900000", "0.01800000", "0.01600000"], authentication: ["0.02000000", "0.01900000", "0.01800000", "0.01600000"] },
  EU: {
    marketing: "0.60000000",
    utility: ["0.22000000", "0.21000000", "0.20000000", "0.18000000"],
    authentication: ["0.20000000", "0.19000000", "0.18000000", "0.16000000"],
    authenticationInternational: ["0.30000000", "0.29000000", "0.28000000", "0.26000000"],
  },
  OTHER: { marketing: "0.33000000", utility: ["0.04200000", "0.04000000", "0.03800000", "0.03500000"], authentication: ["0.04200000", "0.04000000", "0.03800000", "0.03500000"] },
};

const BRL_2026: Record<string, MarketSpec> = {
  ...BRL_2025,
  BR: { marketing: "0.33600000", utility: ["0.04000000", "0.03800000", "0.03600000", "0.03300000"], authentication: ["0.04000000", "0.03800000", "0.03600000", "0.03300000"] },
};

const USD_2025: Record<string, MarketSpec> = {
  BR: { marketing: "0.05900000", utility: ["0.00750000", "0.00710000", "0.00670000", "0.00610000"], authentication: ["0.00750000", "0.00710000", "0.00670000", "0.00610000"] },
  US: { marketing: "0.02500000", utility: ["0.00370000", "0.00350000", "0.00330000", "0.00300000"], authentication: ["0.00370000", "0.00350000", "0.00330000", "0.00300000"] },
  EU: {
    marketing: "0.11000000",
    utility: ["0.04100000", "0.03900000", "0.03700000", "0.03300000"],
    authentication: ["0.03700000", "0.03500000", "0.03300000", "0.03000000"],
    authenticationInternational: ["0.05600000", "0.05400000", "0.05200000", "0.04800000"],
  },
  OTHER: { marketing: "0.06100000", utility: ["0.00780000", "0.00740000", "0.00700000", "0.00650000"], authentication: ["0.00780000", "0.00740000", "0.00700000", "0.00650000"] },
};

const USD_2026: Record<string, MarketSpec> = {
  ...USD_2025,
  BR: { marketing: "0.06200000", utility: ["0.00750000", "0.00710000", "0.00670000", "0.00610000"], authentication: ["0.00750000", "0.00710000", "0.00670000", "0.00610000"] },
};

function rowsFor(currency: string, from: string, until: string | null, spec: Record<string, MarketSpec>, includeService: boolean): RateRow[] {
  const out: RateRow[] = [];
  const add = (market: string, category: C, start: number, end: number | null, rate: string) =>
    out.push({ market, currency, category, tierStart: start, tierEnd: end, unitRate: new Money(rate), effectiveFrom: from, effectiveUntil: until });
  for (const [market, m] of Object.entries(spec)) {
    add(market, C.MARKETING, 1, null, m.marketing);
    add(market, C.MARKETING_LITE, 1, null, m.marketing);
    DEMO_TIER_BOUNDS.forEach(([s, e], i) => {
      add(market, C.UTILITY, s, e, m.utility[i]!);
      add(market, C.AUTHENTICATION, s, e, m.authentication[i]!);
      if (m.authenticationInternational) add(market, C.AUTHENTICATION_INTERNATIONAL, s, e, m.authenticationInternational[i]!);
    });
    // Oct-2026 policy: service rate = utility rate by market (flat, no tiers).
    if (includeService) add(market, C.SERVICE, 1, null, m.utility[0]);
  }
  return out;
}

function demoCard(id: string, currency: string, from: string, until: string | null, spec: Record<string, MarketSpec>, includeService: boolean): RateCard {
  const rows = rowsFor(currency, from, until, spec, includeService);
  const meta: RateCardMeta = {
    id,
    name: `${id} (DEMO — valores fictícios)`,
    currency,
    effectiveFrom: from,
    effectiveUntil: until,
    sourceUrl: DEMO_SOURCE_URL,
    sourceDocument: DEMO_DOCUMENT,
    isDemo: true,
    checksum: sha256Hex(JSON.stringify(rows.map((r) => ({ ...r, unitRate: r.unitRate.toString() })))),
    marketAliases: DEMO_MARKET_ALIASES,
  };
  return new RateCard(meta, rows);
}

export function demoRateCards(): RateCard[] {
  return [
    demoCard("DEMO-BRL-2025-07", "BRL", "2025-07-01", "2026-09-30", BRL_2025, false),
    demoCard("DEMO-BRL-2026-10", "BRL", "2026-10-01", null, BRL_2026, true),
    demoCard("DEMO-USD-2025-07", "USD", "2025-07-01", "2026-09-30", USD_2025, false),
    demoCard("DEMO-USD-2026-10", "USD", "2026-10-01", null, USD_2026, true),
  ];
}

export function demoRateCatalog(): RateCatalog {
  return new RateCatalog(demoRateCards());
}
