import { type BillingCategory, isWithinLocalDates, Region } from "@wco/domain";
import { TierCalculator } from "./tier-calculator";
import type { RateCardMeta, RateRow, TierInfo } from "./types";

/**
 * An imported rate card (PriceCatalogImport + PriceCatalog rows) for ONE currency.
 * Prices are never hardcoded in components or engines (spec §15): everything comes from here.
 */
export class RateCard {
  private readonly byKey = new Map<string, RateRow[]>();
  private readonly aliasOf = new Map<string, string>();
  private readonly calcCache = new Map<string, TierCalculator>();

  constructor(
    readonly meta: RateCardMeta,
    rows: RateRow[],
  ) {
    for (const r of rows) {
      if (r.currency !== meta.currency) throw new Error(`Row currency ${r.currency} != card currency ${meta.currency}`);
      const key = `${r.market}|${r.category}`;
      const list = this.byKey.get(key) ?? [];
      list.push(r);
      this.byKey.set(key, list);
    }
    for (const [catalogMarket, resolved] of Object.entries(meta.marketAliases ?? {})) {
      for (const m of resolved) this.aliasOf.set(m, catalogMarket);
    }
  }

  get id(): string {
    return this.meta.id;
  }

  isEffectiveOn(billingDate: string): boolean {
    return isWithinLocalDates(billingDate, this.meta.effectiveFrom, this.meta.effectiveUntil);
  }

  /** Resolved Meta market → catalog market (exact, alias, then OTHER). */
  catalogMarketFor(market: string, category: BillingCategory): string | null {
    if (this.byKey.has(`${market}|${category}`)) return market;
    const alias = this.aliasOf.get(market);
    if (alias && this.byKey.has(`${alias}|${category}`)) return alias;
    if (this.byKey.has(`${Region.OTHER}|${category}`)) return Region.OTHER;
    return null;
  }

  hasCategory(market: string, category: BillingCategory): boolean {
    return this.catalogMarketFor(market, category) !== null;
  }

  /** Tier calculator for (market, category) effective on a local billing date, or null if not priced. */
  calculator(market: string, category: BillingCategory, billingDate: string): { calc: TierCalculator; catalogMarket: string } | null {
    const catalogMarket = this.catalogMarketFor(market, category);
    if (!catalogMarket) return null;
    const rows = (this.byKey.get(`${catalogMarket}|${category}`) ?? []).filter((r) =>
      isWithinLocalDates(billingDate, r.effectiveFrom, r.effectiveUntil),
    );
    if (rows.length === 0) return null;
    const cacheKey = `${catalogMarket}|${category}|${rows.map((r) => `${r.effectiveFrom}:${r.tierStart}`).join(",")}`;
    let calc = this.calcCache.get(cacheKey);
    if (!calc) {
      calc = new TierCalculator(rows.map((r) => ({ start: r.tierStart, end: r.tierEnd, rate: r.unitRate })));
      this.calcCache.set(cacheKey, calc);
    }
    return { calc, catalogMarket };
  }

  tierInfo(calc: TierCalculator, position: number): TierInfo {
    const { index, band } = calc.tierAt(position);
    return { index, start: band.start, end: band.end, label: band.label ?? `Tier ${index}` };
  }

  markets(): string[] {
    return [...new Set([...this.byKey.keys()].map((k) => k.split("|")[0]!))];
  }

  rows(): RateRow[] {
    return [...this.byKey.values()].flat();
  }
}

/**
 * All imported rate cards. Selection: currency + billing date; a real (non-demo) card always wins
 * over a DEMO card effective on the same date.
 */
export class RateCatalog {
  constructor(readonly cards: RateCard[]) {}

  select(currency: string, billingDate: string): RateCard | null {
    const candidates = this.cards.filter((c) => c.meta.currency === currency && c.isEffectiveOn(billingDate));
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => {
      if (a.meta.isDemo !== b.meta.isDemo) return a.meta.isDemo ? 1 : -1;
      return b.meta.effectiveFrom.localeCompare(a.meta.effectiveFrom);
    });
    return candidates[0]!;
  }

  currencies(): string[] {
    return [...new Set(this.cards.map((c) => c.meta.currency))];
  }
}
