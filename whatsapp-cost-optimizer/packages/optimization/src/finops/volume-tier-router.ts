export interface WabaPool { wabaId: string; phoneId: string; vol: number; tiers: Array<{ min: number; usd: number }>; }
export function routeByVolumeTier(pools: WabaPool[], lookahead = 200) {
  const rank = pools.map(p => {
    const cur = [...p.tiers].sort((a, b) => b.min - a.min).find(t => p.vol >= t.min) ?? p.tiers[0] ?? { min: 0, usd: 0.0068 };
    const nxt = [...p.tiers].sort((a, b) => a.min - b.min).find(t => t.min > p.vol);
    const gap = nxt ? nxt.min - p.vol : 1e9;
    const eff = cur.usd - (nxt && gap <= lookahead ? ((cur.usd - nxt.usd) * lookahead) / gap : 0);
    return { wabaId: p.wabaId, phoneId: p.phoneId, unitUsd: cur.usd, eff, gapToNext: nxt ? gap : null };
  }).sort((a, b) => a.eff - b.eff);
  const first = rank[0], last = rank[rank.length - 1];
  return { chosen: first ?? null, unitSavedUsd: first && last ? +(last.unitUsd - first.unitUsd).toFixed(6) : 0 };
}
