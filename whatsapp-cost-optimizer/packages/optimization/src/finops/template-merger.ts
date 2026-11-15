export interface MergeEvent { intentId: string; text: string; category: 'UTILITY' | 'MARKETING'; }
export function mergeOutOfWindowUtility(events: MergeEvent[], templateName: string, maxSlots: number, unitUsd = 0.0068) {
  const list = events.filter(e => e.category === 'UTILITY').slice(0, maxSlots);
  if (list.length < 2) return { merged: false as const, savedUsd: 0 };
  return { merged: true as const, templateName, coveredIds: list.map(e => e.intentId), params: list.map((e, i) => ({ key: `v${i + 1}`, val: e.text })), savedUsd: +((list.length - 1) * unitUsd).toFixed(6) };
}
