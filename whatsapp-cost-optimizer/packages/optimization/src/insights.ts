import { Money, OpportunityType, money, type Decimal } from "@wco/domain";

/**
 * Explainable recommendations (spec §95), optimization opportunities (spec §61, §96) and cost
 * anomaly detection (spec §94). Pure functions over aggregated metrics — no AI, no guarantees.
 */
export interface EventTypeStats {
  eventType: string;
  intents: number;
  deduplicated: number;
  superseded: number;
  consolidated: number;
  sent: number;
  /** Intents for the same entity within 2 minutes of the previous one (burstiness). */
  burstIntents: number;
  aggregationEnabled: boolean;
  supersessionEnabled: boolean;
  /** Paid messages sent less than 6h after a free window (CSW/FEP) closed for that customer. */
  paidJustAfterWindow: number;
  averageCost: Decimal;
}

export interface Recommendation {
  id: string;
  title: string;
  description: string;
  evidence: Record<string, number | string>;
  potentialSaving: string;
  currency: string;
  confidence: number;
  label: "ESTIMATED";
}

const pct = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 1000) / 10);

export function recommend(stats: EventTypeStats[], currency: string): Recommendation[] {
  const out: Recommendation[] = [];
  for (const s of stats) {
    if (s.intents < 20) continue;
    const supersededPct = pct(s.superseded, s.intents);
    if (supersededPct >= 20) {
      out.push({
        id: `supersession:${s.eventType}`,
        title: `${supersededPct}% dos eventos de ${s.eventType} foram substituídos antes do envio.`,
        description: "Atualizações sucessivas da mesma entidade foram substituídas pela mais recente enquanto ainda estavam no buffer.",
        evidence: { intents: s.intents, superseded: s.superseded },
        potentialSaving: s.averageCost.times(s.superseded).toFixed(2),
        currency,
        confidence: 0.9,
        label: "ESTIMATED",
      });
    }
    const burstPct = pct(s.burstIntents, s.intents);
    if (!s.aggregationEnabled && burstPct >= 15) {
      out.push({
        id: `consolidation:${s.eventType}`,
        title: `Você pode consolidar eventos semelhantes de ${s.eventType}.`,
        description: `${burstPct}% dos eventos chegaram até 2 minutos após outro evento da mesma entidade. Com um template de resumo aprovado pela Meta, eles poderiam virar uma única mensagem.`,
        evidence: { intents: s.intents, burstIntents: s.burstIntents },
        potentialSaving: s.averageCost.times(Math.floor(s.burstIntents / 2)).toFixed(2),
        currency,
        confidence: 0.6,
        label: "ESTIMATED",
      });
    }
    const dupPct = pct(s.deduplicated, s.intents);
    if (dupPct >= 10) {
      out.push({
        id: `dedup:${s.eventType}`,
        title: `${dupPct}% das mensagens analisadas de ${s.eventType} foram duplicadas.`,
        description: "O sistema de origem está emitindo o mesmo evento mais de uma vez. A deduplicação evitou os envios; corrigir a origem reduz também o custo de processamento.",
        evidence: { intents: s.intents, deduplicated: s.deduplicated },
        potentialSaving: s.averageCost.times(s.deduplicated).toFixed(2),
        currency,
        confidence: 0.95,
        label: "ESTIMATED",
      });
    }
    if (s.paidJustAfterWindow > 0) {
      out.push({
        id: `window:${s.eventType}`,
        title: "Existem mensagens enviadas fora de janelas em que outra regra de custo poderia ser aplicável.",
        description: `${s.paidJustAfterWindow} mensagens de ${s.eventType} foram cobradas pouco depois do fechamento de uma janela gratuita. Se o negócio permitir enviá-las mais cedo, configure maxDelay/janela de envio para o scheduler considerá-las.`,
        evidence: { paidJustAfterWindow: s.paidJustAfterWindow },
        potentialSaving: s.averageCost.times(s.paidJustAfterWindow).toFixed(2),
        currency,
        confidence: 0.5,
        label: "ESTIMATED",
      });
    }
  }
  return out.sort((a, b) => Number(b.potentialSaving) - Number(a.potentialSaving));
}

export interface OpportunityInput {
  currency: string;
  averageCost: Decimal;
  duplicates: number;
  burstIntents: number;
  paidJustAfterWindow: number;
  freeEntryPointEligibleMissed: number;
  tierNote?: string;
  bspMonthlyFees?: Decimal;
}

export interface OpportunityView {
  type: OpportunityType;
  title: string;
  potentialSaving: string;
  currency: string;
  confidence: number;
  note: string;
}

export function opportunities(input: OpportunityInput): OpportunityView[] {
  const f = (d: Decimal) => d.toDecimalPlaces(2).toFixed(2);
  const list: OpportunityView[] = [
    {
      type: OpportunityType.DUPLICATE,
      title: "Taxa de duplicação na origem",
      potentialSaving: f(input.averageCost.times(input.duplicates)),
      currency: input.currency,
      confidence: 0.95,
      note: "Eventos duplicados detectados pelo eventHash dentro da janela de deduplicação.",
    },
    {
      type: OpportunityType.CONSOLIDATION,
      title: "Oportunidade de consolidação",
      potentialSaving: f(input.averageCost.times(Math.floor(input.burstIntents / 2))),
      currency: input.currency,
      confidence: 0.6,
      note: "Exige template-resumo aprovado; a economia depende da tolerância do negócio a atraso.",
    },
    {
      type: OpportunityType.FREE_WINDOW,
      title: "Aproveitamento de Free Entry Point",
      potentialSaving: f(input.averageCost.times(input.freeEntryPointEligibleMissed + input.paidJustAfterWindow)),
      currency: input.currency,
      confidence: 0.5,
      note: "A janela FEP só abre quando a empresa responde em até 24h a uma mensagem vinda de anúncio Click-to-WhatsApp ou CTA de Página (apps móveis).",
    },
    {
      type: OpportunityType.VOLUME_TIER,
      title: "Tiers de volume",
      potentialSaving: "0.00",
      currency: input.currency,
      confidence: 0.3,
      note:
        input.tierNote ??
        "Tiers acumulam por portfólio empresarial, mercado e categoria. O WCO nunca envia mensagens extras para atingir um tier; consolidar WABAs em um portfólio é a única alavanca estrutural.",
    },
  ];
  if (input.bspMonthlyFees && input.bspMonthlyFees.isPositive()) {
    list.push({
      type: OpportunityType.BSP_MARKUP,
      title: "Taxas de BSP",
      potentialSaving: f(input.bspMonthlyFees),
      currency: input.currency,
      confidence: 0.4,
      note: "Somente se a operação puder usar a Cloud API diretamente; considere os custos extras de operar sem BSP.",
    });
  }
  return list;
}

export interface AnomalyResult {
  anomalous: boolean;
  mean: string;
  today: string;
  increasePercent: number | null;
  message: string | null;
}

/** "Se custo diário > média histórica + threshold: alert." */
export function detectCostAnomaly(history: Decimal[], today: Decimal, thresholdPercent = 50, minDays = 7): AnomalyResult {
  if (history.length < minDays) return { anomalous: false, mean: "0", today: today.toFixed(2), increasePercent: null, message: null };
  const mean = history.reduce((a, b) => a.plus(b), new Money(0) as Decimal).dividedBy(history.length);
  if (mean.isZero()) {
    return { anomalous: today.isPositive(), mean: "0", today: today.toFixed(2), increasePercent: null, message: today.isPositive() ? "Custo surgiu após dias sem custo." : null };
  }
  const increase = today.dividedBy(mean).minus(1).times(100);
  const anomalous = increase.greaterThan(thresholdPercent);
  const inc = Math.round(increase.toNumber());
  return {
    anomalous,
    mean: mean.toFixed(2),
    today: today.toFixed(2),
    increasePercent: inc,
    message: anomalous ? `Custo ${inc}% acima da média.` : null,
  };
}

export { money };
