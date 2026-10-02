/** Seeded PRNG (mulberry32) — every dataset and experiment is reproducible from its seed. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }

  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  bool(p: number): boolean {
    return this.next() < p;
  }

  int(min: number, maxInclusive: number): number {
    return min + Math.floor(this.next() * (maxInclusive - min + 1));
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]!;
  }

  weighted<T extends string>(weights: Record<T, number>): T {
    const entries = Object.entries(weights) as Array<[T, number]>;
    const total = entries.reduce((a, [, w]) => a + w, 0);
    let r = this.next() * total;
    for (const [k, w] of entries) {
      if ((r -= w) < 0) return k;
    }
    return entries[entries.length - 1]![0];
  }

  /** Exponential inter-arrival (minutes → ms). */
  expMs(meanMs: number): number {
    return -Math.log(1 - this.next()) * meanMs;
  }
}
