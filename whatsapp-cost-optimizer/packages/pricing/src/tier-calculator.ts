import { Money, type Decimal } from "@wco/domain";

/**
 * Volume-tier distribution (spec §5, S1 "Volume tiers examples"):
 *
 *   "A business that sends a total of B authentication messages in a month to India is charged:
 *    List rate for the first A messages. Tier rate 1 for messages A+1 to B.
 *    Total charges for that month = Rate per tier x messages in each tier."
 *
 * i.e. marginal (bracket) pricing. A message's rate depends on its 1-based position in the month for
 * (business portfolio, market, category). NEVER `count × rate of the highest tier reached`.
 */
export interface TierBand {
  start: number; // inclusive, 1-based
  end: number | null; // inclusive, null = unbounded
  rate: Decimal;
  label?: string;
}

export interface TierSlice {
  tierIndex: number;
  label: string;
  from: number;
  to: number;
  count: number;
  rate: Decimal;
  subtotal: Decimal;
}

export class TierCalculator {
  readonly bands: readonly TierBand[];

  constructor(bands: TierBand[]) {
    if (bands.length === 0) throw new Error("TierCalculator requires at least one band");
    const sorted = [...bands].sort((a, b) => a.start - b.start);
    if (sorted[0]!.start !== 1) throw new Error("First tier must start at message 1");
    for (let i = 0; i < sorted.length; i++) {
      const b = sorted[i]!;
      const next = sorted[i + 1];
      if (b.end !== null && b.end < b.start) throw new Error(`Invalid tier ${b.start}-${b.end}`);
      if (next) {
        if (b.end === null) throw new Error("Only the last tier can be unbounded");
        if (next.start !== b.end + 1) throw new Error(`Tiers must be contiguous (gap/overlap after ${b.end})`);
      }
    }
    this.bands = sorted.map((b, i) => ({ ...b, label: b.label ?? defaultLabel(b, i) }));
  }

  static flat(rate: Decimal): TierCalculator {
    return new TierCalculator([{ start: 1, end: null, rate }]);
  }

  /** Tier of the message at 1-based `position`. Beyond a bounded last tier, the last tier applies. */
  tierAt(position: number): { index: number; band: TierBand } {
    if (position < 1) throw new Error("Tier positions are 1-based");
    for (let i = 0; i < this.bands.length; i++) {
      const b = this.bands[i]!;
      if (position >= b.start && (b.end === null || position <= b.end)) return { index: i, band: b };
    }
    const last = this.bands.length - 1;
    return { index: last, band: this.bands[last]! };
  }

  rateAt(position: number): Decimal {
    return this.tierAt(position).band.rate;
  }

  /**
   * Cost of `count` charged messages that come after `alreadyCharged` messages in the same month.
   * Returns the per-tier breakdown.
   */
  cost(alreadyCharged: number, count: number): { total: Decimal; slices: TierSlice[] } {
    if (count < 0 || alreadyCharged < 0) throw new Error("Counts must be non-negative");
    const slices: TierSlice[] = [];
    let total: Decimal = new Money(0);
    let from = alreadyCharged + 1;
    const lastPos = alreadyCharged + count;
    while (from <= lastPos) {
      const { index, band } = this.tierAt(from);
      const isLast = index === this.bands.length - 1;
      const bandEnd = band.end === null || isLast ? lastPos : Math.min(band.end, lastPos);
      const to = Math.max(from, bandEnd);
      const n = to - from + 1;
      const subtotal = band.rate.times(n);
      slices.push({ tierIndex: index, label: band.label ?? "", from, to, count: n, rate: band.rate, subtotal });
      total = total.plus(subtotal);
      from = to + 1;
    }
    return { total, slices };
  }
}

function defaultLabel(b: TierBand, i: number): string {
  if (i === 0) return b.end === null ? "List rate" : `List rate (1-${b.end.toLocaleString("en-US")})`;
  return b.end === null
    ? `Tier ${i} (${b.start.toLocaleString("en-US")}+)`
    : `Tier ${i} (${b.start.toLocaleString("en-US")}-${b.end.toLocaleString("en-US")})`;
}
