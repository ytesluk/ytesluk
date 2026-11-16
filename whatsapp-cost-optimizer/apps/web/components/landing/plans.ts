/**
 * Public plan table. Mirrors the plans seeded by the API (packages/services/src/seed.ts, PLANS):
 * change both together. `fee: null` = price on request.
 */
export const PLANS: Array<{ code: string; name: string; fee: number | null; events: number; blurb: string }> = [
  { code: "FREE", name: "Free", fee: 0, events: 1_000, blurb: "Para ligar o seu sistema e ver os primeiros números." },
  { code: "STARTER", name: "Starter", fee: 199, events: 50_000, blurb: "Para a operação que já avisa clientes todos os dias." },
  { code: "PRO", name: "Pro", fee: 899, events: 500_000, blurb: "Para volume alto, com vários sistemas enviando." },
  { code: "ENTERPRISE", name: "Enterprise", fee: null, events: 100_000_000, blurb: "Para quem passa de meio milhão de avisos por mês." },
];
