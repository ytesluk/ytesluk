import { EntryPointType, Priority } from "@wco/domain";
import type { IntentSubmission } from "@wco/optimization";
import { Rng } from "./rng";

/**
 * Synthetic dataset generator (spec §40). Produces a time-ordered stream of business events
 * (intents) and customer messages (inbound), with explicit, documented knobs. Same seed → same data.
 *
 * Episodes (realistic shapes, all parameters are assumptions documented in ACADEMIC-EXPERIMENT.md):
 *  - order flow:   order.status (CREATED, PACKED, SHIPPED) + payment.approved + shipment.tracking
 *                  "burst" flows emit all updates within ~1 minute (integration batches/retries);
 *                  other flows spread over hours/days. Optionally the customer writes (opens a CSW).
 *  - OTP:          authentication.otp (unique code; sometimes a resend with a NEW code — not a duplicate)
 *  - campaigns:    weekly marketing.campaign to a share of customers (deferrable within 24h)
 *  - cart reminder: cart.reminder preferred 4h later, deferrable within 12h
 *  - support:      inbound (possibly Click-to-WhatsApp ad) → free-form replies (service) → follow-ups
 *  - critical:     fraud/security alerts (never delayed)
 *  - appointment:  reminders scheduled for the day before; sometimes rescheduled (supersession)
 *  - duplicates:   the source system re-emits an event (same payload) with probability duplicateRate
 */
export interface ScenarioParams {
  name: string;
  seed: number;
  /** Target number of business events (intents), excluding customer inbound messages. */
  events: number;
  customers: number;
  start: string;
  days: number;
  timezone: string;
  currency: string;
  phoneNumbers: number;
  markets: Record<"BR" | "US" | "EU" | "OTHER", number>;
  mix: { order: number; otp: number; marketing: number; cartReminder: number; support: number; critical: number; appointment: number };
  duplicateRate: number;
  burstRate: number;
  fepRate: number;
  fepQualifiedRate: number;
  serviceWindowRate: number;
  deliveryRate: number;
}

export const DEFAULT_SCENARIO: ScenarioParams = {
  name: "default",
  seed: 20261002,
  events: 100_000,
  customers: 20_000,
  start: "2026-10-01T03:00:00.000Z", // 2026-10-01 00:00 America/Sao_Paulo
  days: 30,
  timezone: "America/Sao_Paulo",
  currency: "BRL",
  phoneNumbers: 2,
  markets: { BR: 0.9, US: 0.05, EU: 0.03, OTHER: 0.02 },
  mix: { order: 0.5, otp: 0.12, marketing: 0.15, cartReminder: 0.05, support: 0.1, critical: 0.03, appointment: 0.05 },
  duplicateRate: 0.08,
  burstRate: 0.35,
  fepRate: 0.25,
  fepQualifiedRate: 0.7,
  serviceWindowRate: 0.15,
  deliveryRate: 0.97,
};

export type Level = "LOW" | "MEDIUM" | "HIGH";
export type ScenarioName = `${Level}_${"DUPLICATION" | "AGGREGATION" | "FEP"}`;

/** Scenario presets (spec §40). Only the named dimension varies; everything else stays at default. */
export function scenarioPreset(name: ScenarioName, base: Partial<ScenarioParams> = {}): ScenarioParams {
  const [level, dim] = name.split("_") as [Level, string];
  const v = { LOW: 0, MEDIUM: 1, HIGH: 2 }[level];
  const p: ScenarioParams = { ...DEFAULT_SCENARIO, ...base, name };
  if (dim === "DUPLICATION") p.duplicateRate = [0.02, 0.08, 0.2][v]!;
  if (dim === "AGGREGATION") p.burstRate = [0.1, 0.35, 0.7][v]!;
  if (dim === "FEP") p.fepRate = [0.05, 0.25, 0.6][v]!;
  return p;
}

export const SCENARIOS: ScenarioName[] = [
  "LOW_DUPLICATION",
  "MEDIUM_DUPLICATION",
  "HIGH_DUPLICATION",
  "LOW_AGGREGATION",
  "MEDIUM_AGGREGATION",
  "HIGH_AGGREGATION",
  "LOW_FEP",
  "MEDIUM_FEP",
  "HIGH_FEP",
];

export type DatasetEvent =
  | { kind: "INBOUND"; at: number; customerKey: string; phoneNumberId: string; entryPoint?: EntryPointType; tag: string }
  | { kind: "INTENT"; at: number; sub: IntentSubmission; tag: string; duplicate: boolean };

interface Customer {
  key: string;
  recipient: string;
  market: string;
  phoneNumberId: string;
}

const pad = (n: number, w: number) => String(n).padStart(w, "0");

function phoneFor(market: string, i: number): string {
  switch (market) {
    case "US":
      return `+1415${pad(1_000_000 + (i % 8_999_999), 7)}`;
    case "EU":
      return `+336${pad(10_000_000 + (i % 89_999_999), 8)}`;
    case "OTHER":
      return `+234803${pad(i % 9_999_999, 7)}`;
    default:
      return `+55119${pad(10_000_000 + (i % 89_999_999), 8)}`;
  }
}

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Generates the full dataset, time-ordered. */
export function generateDataset(params: ScenarioParams): DatasetEvent[] {
  const rng = new Rng(params.seed);
  const start = new Date(params.start).getTime();
  const end = start + params.days * DAY;
  const customers: Customer[] = Array.from({ length: params.customers }, (_, i) => {
    const market = rng.weighted(params.markets);
    return { key: `c${i}`, recipient: phoneFor(market, i), market, phoneNumberId: `pn-${i % Math.max(1, params.phoneNumbers)}` };
  });
  const out: DatasetEvent[] = [];
  let intents = 0;
  let seq = 0;
  const inRange = (t: number) => t >= start && t < end;

  const emit = (at: number, c: Customer, s: Omit<IntentSubmission, "customerKey" | "recipient" | "phoneNumberId">, tag: string) => {
    if (!inRange(at)) return;
    const sub: IntentSubmission = { ...s, customerKey: c.key, recipient: c.recipient, phoneNumberId: c.phoneNumberId };
    out.push({ kind: "INTENT", at, sub, tag, duplicate: false });
    intents++;
    if (rng.bool(params.duplicateRate)) {
      // Source system re-emits the same event: either a retry with the same idempotency key or a new delivery of the same payload.
      const sameKey = rng.bool(0.5);
      const dup: IntentSubmission = { ...sub, id: undefined, idempotencyKey: sameKey ? sub.idempotencyKey : undefined };
      out.push({ kind: "INTENT", at: at + rng.int(1_000, 120_000), sub: dup, tag, duplicate: true });
      intents++;
    }
  };
  const inbound = (at: number, c: Customer, tag: string, entryPoint?: EntryPointType) => {
    if (inRange(at)) out.push({ kind: "INBOUND", at, customerKey: c.key, phoneNumberId: c.phoneNumberId, entryPoint, tag });
  };
  const id = () => `e${++seq}`;

  // Weekly campaigns: Thursdays-ish at 10:00 local (13:00Z), audience sized from the marketing share.
  const campaignDays = [2, 9, 16, 23].filter((d) => d < params.days);
  const perCampaign = Math.round((params.events * params.mix.marketing) / Math.max(1, campaignDays.length) / (1 + params.duplicateRate));
  for (const [ci, d] of campaignDays.entries()) {
    const t = start + d * DAY + 10 * HOUR;
    for (let k = 0; k < perCampaign; k++) {
      const c = customers[rng.int(0, customers.length - 1)]!;
      emit(
        t + rng.int(0, 30 * MIN),
        c,
        {
          idempotencyKey: id(),
          eventType: "marketing.campaign",
          businessEntityId: `campaign-${ci}`,
          data: { offer: `Oferta ${ci + 1}`, campaign: ci },
          priority: Priority.LOW,
          maxDelaySeconds: 24 * 3600,
        },
        "campaign",
      );
    }
  }

  const otherMix = { ...params.mix, marketing: 0 };
  while (intents < params.events) {
    const kind = rng.weighted(otherMix);
    const c = customers[rng.int(0, customers.length - 1)]!;
    const t0 = start + Math.floor(rng.next() * (end - start));
    switch (kind) {
      case "order": {
        const orderId = `ORD-${++seq}`;
        const burst = rng.bool(params.burstRate);
        const steps: Array<[number, string, Record<string, unknown>]> = burst
          ? [
              [0, "order.status", { orderId, status: "CREATED", statusLabel: "pedido recebido" }],
              [rng.int(3, 15) * 1000, "payment.approved", { orderId, amount: `R$ ${rng.int(30, 900)},00`, statusLabel: "pagamento aprovado" }],
              [rng.int(16, 30) * 1000, "order.status", { orderId, status: "PACKED", statusLabel: "separado" }],
              [rng.int(31, 45) * 1000, "order.status", { orderId, status: "SHIPPED", statusLabel: "enviado" }],
              [rng.int(46, 55) * 1000, "shipment.tracking", { orderId, tracking: `BR${rng.int(100000, 999999)}`, statusLabel: "rastreio disponível" }],
            ]
          : [
              [0, "order.status", { orderId, status: "CREATED", statusLabel: "pedido recebido" }],
              [rng.int(1, 30) * MIN, "payment.approved", { orderId, amount: `R$ ${rng.int(30, 900)},00`, statusLabel: "pagamento aprovado" }],
              [rng.int(2, 20) * HOUR, "order.status", { orderId, status: "PACKED", statusLabel: "separado" }],
              [rng.int(21, 48) * HOUR, "order.status", { orderId, status: "SHIPPED", statusLabel: "enviado" }],
              [rng.int(21, 48) * HOUR + rng.int(1, 10) * MIN, "shipment.tracking", { orderId, tracking: `BR${rng.int(100000, 999999)}`, statusLabel: "rastreio disponível" }],
            ];
        // shipment.tracking must come after SHIPPED
        steps.sort((a, b) => a[0] - b[0]);
        for (const [dt, eventType, data] of steps) {
          emit(t0 + dt, c, { idempotencyKey: id(), eventType, businessEntityId: orderId, data, occurredAt: new Date(t0 + dt) }, burst ? "order_burst" : "order_spread");
        }
        if (rng.bool(params.serviceWindowRate)) {
          const ti = t0 + rng.int(5, 120) * MIN;
          inbound(ti, c, "order_question");
          emit(ti + rng.int(1, 15) * MIN, c, { idempotencyKey: id(), eventType: "support.reply", businessEntityId: `chat-${orderId}`, data: { topic: "order" }, freeFormText: "Resposta do atendimento" }, "support_reply");
        }
        break;
      }
      case "otp": {
        const login = `login-${++seq}`;
        emit(t0, c, { idempotencyKey: id(), eventType: "authentication.otp", businessEntityId: login, data: { code: String(rng.int(100000, 999999)) } }, "otp");
        if (rng.bool(0.1)) emit(t0 + rng.int(30, 120) * 1000, c, { idempotencyKey: id(), eventType: "authentication.otp", businessEntityId: login, data: { code: String(rng.int(100000, 999999)) } }, "otp_resend");
        break;
      }
      case "cartReminder": {
        const cart = `cart-${++seq}`;
        emit(t0, c, { idempotencyKey: id(), eventType: "cart.reminder", businessEntityId: cart, data: { items: `${rng.int(1, 4)} item(ns)` }, earliestSendAt: new Date(t0), preferredSendAt: new Date(t0 + 4 * HOUR), maxDelaySeconds: 8 * 3600 }, "cart");
        break;
      }
      case "support": {
        const chat = `chat-${++seq}`;
        const viaAd = rng.bool(params.fepRate);
        const qualified = viaAd && rng.bool(params.fepQualifiedRate);
        inbound(t0, c, viaAd ? (qualified ? "ctwa_qualified" : "ctwa_unqualified") : "organic", viaAd ? (qualified ? EntryPointType.CLICK_TO_WHATSAPP_AD : EntryPointType.OTHER) : undefined);
        const turns = rng.int(1, 4);
        let t = t0;
        for (let k = 0; k < turns; k++) {
          t += rng.int(1, 20) * MIN;
          if (k > 0) {
            inbound(t, c, "support_turn");
            t += rng.int(1, 10) * MIN;
          }
          emit(t, c, { idempotencyKey: id(), eventType: "support.reply", businessEntityId: chat, data: { turn: k }, freeFormText: "Resposta do atendimento" }, "support_reply");
        }
        // Follow-ups after the conversation. Without WCO the business sends them at its preferred time (3–6 days
        // later, i.e. after a 72h FEP window would have closed); the intent declares that any time from
        // `earliestSendAt` up to the deadline is acceptable, so the scheduler MAY send it earlier.
        if (rng.bool(0.6)) {
          const pref = t0 + rng.int(76, 140) * HOUR;
          emit(t + MIN, c, { idempotencyKey: id(), eventType: "cart.reminder", businessEntityId: `cart-${chat}`, data: { items: "1 item" }, earliestSendAt: new Date(t + 30 * MIN), preferredSendAt: new Date(pref), maxDelaySeconds: 6 * 3600 }, "followup_cart");
        }
        if (rng.bool(0.4)) {
          const pref = t0 + rng.int(80, 160) * HOUR;
          emit(t + 2 * MIN, c, { idempotencyKey: id(), eventType: "marketing.campaign", businessEntityId: `offer-${chat}`, data: { offer: "Oferta personalizada" }, earliestSendAt: new Date(t + 60 * MIN), preferredSendAt: new Date(pref), maxDelaySeconds: 6 * 3600, priority: Priority.LOW }, "followup_offer");
        }
        break;
      }
      case "critical": {
        const ev = rng.bool(0.5) ? "fraud.alert" : "critical.security";
        emit(t0, c, { idempotencyKey: id(), eventType: ev, businessEntityId: `alert-${++seq}`, data: { amount: `R$ ${rng.int(100, 5000)},00`, merchant: "Loja X", event: "novo acesso" } }, "critical");
        break;
      }
      case "appointment": {
        const appt = `appt-${++seq}`;
        const dayBefore = t0 + rng.int(1, 5) * DAY;
        const pref = dayBefore - (dayBefore % DAY) + 13 * HOUR; // 10:00 local
        emit(t0, c, { idempotencyKey: id(), eventType: "appointment.reminder", businessEntityId: appt, data: { date: "amanhã", time: "10:00", version: 1 }, occurredAt: new Date(t0), earliestSendAt: new Date(pref - 6 * HOUR), preferredSendAt: new Date(pref), maxDelaySeconds: 6 * 3600 }, "appointment");
        if (rng.bool(0.2)) {
          const t1 = t0 + rng.int(1, 12) * HOUR;
          emit(t1, c, { idempotencyKey: id(), eventType: "appointment.reminder", businessEntityId: appt, data: { date: "amanhã", time: "15:00", version: 2 }, occurredAt: new Date(t1), earliestSendAt: new Date(pref - 6 * HOUR), preferredSendAt: new Date(pref), maxDelaySeconds: 6 * 3600 }, "appointment_rescheduled");
        }
        break;
      }
    }
  }
  out.sort((a, b) => a.at - b.at);
  return out;
}

export function datasetStats(events: DatasetEvent[]): Record<string, number> {
  const stats: Record<string, number> = { intents: 0, inbound: 0, duplicates: 0 };
  for (const e of events) {
    if (e.kind === "INBOUND") stats.inbound!++;
    else {
      stats.intents!++;
      if (e.duplicate) stats.duplicates!++;
    }
    stats[`tag:${e.tag}`] = (stats[`tag:${e.tag}`] ?? 0) + 1;
  }
  return stats;
}
