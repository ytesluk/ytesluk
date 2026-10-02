import { parse } from "csv-parse/sync";
import { z } from "zod";
import {
  BillingCategory,
  EntryPointType,
  MARKET_MAPPINGS,
  MessageKind,
  PricingStatus,
  Region,
  VerificationStatus,
  billingMonth,
  money,
  percentage,
  type Decimal,
} from "@wco/domain";
import { BUILTIN_POLICIES, CostEngine, PolicyRegistry, demoRateCatalog, type RateCatalog } from "@wco/pricing";
import type { IntentSubmission } from "@wco/optimization";
import type { DatasetEvent, ScenarioParams } from "./dataset";
import { DEFAULT_SCENARIO } from "./dataset";
import { ARMS, runArm, type ArmResult } from "./experiment";

/**
 * Historical CSV import (spec §38):
 *   timestamp,customer,eventType,category,country,template,delivered,status,source,isFEP,isServiceWindow
 *
 * 1. validate every row (errors are reported per line, valid rows continue);
 * 2. baseline: what the historical traffic cost AS SENT (rows with delivered=true), priced with the
 *    policy and rate card in force on each row's date (WABA timezone);
 * 3. WCO simulation: replays the same events through the optimizer (arm E) vs a replay without
 *    optimization (arm A) — the replay pair isolates WCO's effect from data quality issues;
 * 4. report.
 */
const Row = z.object({
  timestamp: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "invalid timestamp (ISO-8601 expected)"),
  customer: z.string().min(3, "customer is required"),
  eventType: z.string().min(1),
  category: z.string().transform((v) => v.trim().toUpperCase()).pipe(z.enum(["MARKETING", "UTILITY", "AUTHENTICATION", "SERVICE"])),
  country: z.string().min(2),
  template: z.string().optional().default(""),
  delivered: z.string().transform((v) => /^(1|true|yes|sim|y)$/i.test(v.trim())),
  status: z.string().optional().default(""),
  source: z.string().optional().default(""),
  isFEP: z.string().optional().default("false").transform((v) => /^(1|true|yes|sim|y)$/i.test(v.trim())),
  isServiceWindow: z.string().optional().default("false").transform((v) => /^(1|true|yes|sim|y)$/i.test(v.trim())),
});
export type HistoryRow = z.infer<typeof Row>;

export interface HistoryImportResult {
  rows: number;
  valid: number;
  invalid: number;
  errors: Array<{ line: number; message: string }>;
  period: { from: string | null; to: string | null };
  asSent: { messages: number; delivered: number; cost: string; free: number; unknown: number; byCategory: Record<string, { delivered: number; cost: string }> };
  replay: { control: ArmResult; optimized: ArmResult } | null;
  savings: { meta: string; percent: string | null; messagesAvoided: number } | null;
  currency: string;
  isDemoRate: boolean;
  label: "ESTIMATED";
  notes: string[];
}

/** ISO alpha-2 → Meta market (latest mapping); unknown → OTHER. */
function marketForCountry(country: string): string {
  const iso = country.trim().toUpperCase();
  const latest = MARKET_MAPPINGS[MARKET_MAPPINGS.length - 1]!;
  return latest.entries.find((e) => e.iso === iso)?.market ?? (iso === "US" || iso === "CA" ? Region.NORTH_AMERICA : Region.OTHER);
}

export function parseHistoryCsv(content: string): { rows: HistoryRow[]; errors: HistoryImportResult["errors"]; total: number } {
  const records = parse(content, { columns: true, skip_empty_lines: true, trim: true, bom: true, relax_column_count: true }) as Array<Record<string, string>>;
  const rows: HistoryRow[] = [];
  const errors: HistoryImportResult["errors"] = [];
  records.forEach((rec, i) => {
    const r = Row.safeParse(rec);
    if (r.success) rows.push(r.data);
    else errors.push({ line: i + 2, message: r.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ") });
  });
  return { rows, errors, total: records.length };
}

export function importHistory(content: string, opts: { timezone?: string; currency?: string; rates?: RateCatalog; maxErrors?: number } = {}): HistoryImportResult {
  const timezone = opts.timezone ?? "America/Sao_Paulo";
  const currency = opts.currency ?? "BRL";
  const rates = opts.rates ?? demoRateCatalog();
  const engine = new CostEngine(new PolicyRegistry(BUILTIN_POLICIES), rates);
  const { rows, errors, total } = parseHistoryCsv(content);
  rows.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  // ---- as sent
  const tier = new Map<string, number>();
  const quota = new Map<string, number>();
  let cost: Decimal = money(0);
  let free = 0;
  let unknown = 0;
  let delivered = 0;
  const byCategory: Record<string, { delivered: number; cost: Decimal }> = {};
  for (const row of rows) {
    if (!row.delivered) continue;
    delivered++;
    const at = new Date(row.timestamp);
    const market = marketForCountry(row.country);
    const category = row.category as BillingCategory;
    const month = billingMonth(at, timezone);
    const tierKey = `${market}|${category}|${month}`;
    const r = engine.evaluate({
      category,
      messageKind: category === BillingCategory.SERVICE ? MessageKind.NON_TEMPLATE : MessageKind.TEMPLATE,
      at,
      timezone,
      currency,
      market,
      businessPhoneNumberId: "history",
      conversation: {
        customerServiceWindow: { lastInboundAt: row.isServiceWindow || category === BillingCategory.SERVICE ? new Date(at.getTime() - 60_000) : null },
        freeEntryPoint: row.isFEP
          ? { type: EntryPointType.CLICK_TO_WHATSAPP_AD, userMessageAt: new Date(at.getTime() - 3_600_000), firstBusinessReplyAt: new Date(at.getTime() - 60_000), windowStartedAt: new Date(at.getTime() - 60_000), confirmedExpiresAt: null, verification: VerificationStatus.CONFIRMED }
          : null,
      },
      quotaUsed: quota.get(month) ?? 0,
      tierPosition: tier.get(tierKey) ?? 0,
      explain: false,
    });
    const bc = (byCategory[category] ??= { delivered: 0, cost: money(0) });
    bc.delivered++;
    if (r.status === PricingStatus.PAID && r.rate) {
      cost = cost.plus(r.rate);
      bc.cost = bc.cost.plus(r.rate);
      if (r.countsTowardTier) tier.set(tierKey, (tier.get(tierKey) ?? 0) + 1);
    } else if (r.status === PricingStatus.QUOTA) {
      quota.set(month, (quota.get(month) ?? 0) + 1);
      free++;
    } else if (r.status === PricingStatus.FREE) free++;
    else unknown++;
  }

  // ---- replay through WCO (A vs E)
  let replay: HistoryImportResult["replay"] = null;
  let savings: HistoryImportResult["savings"] = null;
  if (rows.length > 0) {
    const events: DatasetEvent[] = [];
    rows.forEach((row, i) => {
      const at = Date.parse(row.timestamp);
      const customerKey = `h:${row.customer}`;
      const recipient = `+${row.customer.replace(/\D/g, "") || String(10_000_000_000 + i)}`;
      if (row.isFEP) events.push({ kind: "INBOUND", at: at - 120_000, customerKey, phoneNumberId: "pn-history", entryPoint: EntryPointType.CLICK_TO_WHATSAPP_AD, tag: "history_fep" });
      else if (row.isServiceWindow || row.category === "SERVICE") events.push({ kind: "INBOUND", at: at - 120_000, customerKey, phoneNumberId: "pn-history", tag: "history_csw" });
      const sub: IntentSubmission = {
        customerKey,
        recipient,
        phoneNumberId: "pn-history",
        eventType: row.eventType,
        businessEntityId: null,
        category: row.category as BillingCategory,
        templateName: row.template || null,
        freeFormText: row.category === "SERVICE" ? "reply" : null,
        data: { template: row.template, status: row.status },
        occurredAt: new Date(at),
      };
      events.push({ kind: "INTENT", at, sub, tag: "history", duplicate: false });
    });
    events.sort((a, b) => a.at - b.at);
    const first = rows[0]!.timestamp;
    const params: ScenarioParams = { ...DEFAULT_SCENARIO, name: "history-import", timezone, currency, start: first, days: 31, deliveryRate: delivered / Math.max(1, rows.length) };
    const control = runArm(events, params, ARMS.find((a) => a.id === "A")!, { rates });
    const optimized = runArm(events, params, ARMS.find((a) => a.id === "E")!, { rates });
    replay = { control, optimized };
    const s = money(control.metaCost).minus(optimized.metaCost);
    const p = percentage(s, control.metaCost);
    savings = { meta: s.toFixed(4), percent: p ? p.toFixed(2) : null, messagesAvoided: control.messagesSent - optimized.messagesSent };
  }

  const fmt = (d: Decimal) => d.toDecimalPlaces(4).toFixed(4);
  const maxErrors = opts.maxErrors ?? 200;
  return {
    rows: total,
    valid: rows.length,
    invalid: errors.length,
    errors: errors.slice(0, maxErrors),
    period: { from: rows[0]?.timestamp ?? null, to: rows[rows.length - 1]?.timestamp ?? null },
    asSent: {
      messages: rows.length,
      delivered,
      cost: fmt(cost),
      free,
      unknown,
      byCategory: Object.fromEntries(Object.entries(byCategory).map(([k, v]) => [k, { delivered: v.delivered, cost: fmt(v.cost) }])),
    },
    replay,
    savings,
    currency,
    isDemoRate: rates.cards.every((c) => c.meta.isDemo),
    label: "ESTIMATED",
    notes: [
      "Histórico não traz IDs de entidade: deduplicação e supersession usam (cliente, tipo de evento, conteúdo).",
      "isFEP/isServiceWindow do arquivo são tratados como janelas confirmadas no custo 'como enviado'.",
      "A comparação de economia usa o replay sem otimização (A) vs com WCO (E) sobre os mesmos eventos.",
    ],
  };
}
