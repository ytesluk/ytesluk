import { parse } from "csv-parse/sync";
import { z } from "zod";
import { BILLING_CATEGORIES, BillingCategory, MARKET_MAPPINGS, Money, Region, sha256Hex } from "@wco/domain";
import { RateCard } from "./rate-card";
import { TierCalculator } from "./tier-calculator";
import type { RateCardMeta, RateRow } from "./types";

/**
 * Administrative, versioned rate-card import (spec §15). Meta does not offer a pricing API, so rates
 * are imported from the official CSV/PDF rate cards by an administrator — no scraping.
 *
 * Accepted formats:
 *  1. JSON  { name, currency, effectiveFrom, effectiveUntil?, sourceUrl, sourceDocument, isDemo?,
 *             marketAliases?, rates: [{ market, category, tierStart?, tierEnd?, unitRate }] }
 *  2. CSV "long": market,currency,category,tier_start,tier_end,unit_rate[,effective_from,effective_until]
 *  3. CSV "wide" (rate-card style): Market,Currency,Marketing,Utility,Authentication,
 *     Authentication-International,Service — one list rate per category. Volume tiers can then be
 *     provided in a second "long" CSV (tiersCsv) and are merged per (market, category).
 *
 * NOTE (KNOWN-CONFLICTS C6): the exact column layout of Meta's official CSVs could not be verified
 * from this environment; header matching is therefore tolerant (case/space/dash-insensitive) and the
 * import fails loudly instead of guessing when a column cannot be mapped.
 */

export interface ImportMetadata {
  name: string;
  currency?: string;
  effectiveFrom: string;
  effectiveUntil?: string | null;
  sourceUrl: string;
  sourceDocument: string;
  isDemo?: boolean;
  marketAliases?: Record<string, string[]>;
}

export interface ImportIssue {
  row?: number;
  message: string;
}

export interface ImportResult {
  ok: boolean;
  card?: RateCard;
  rows: RateRow[];
  tiers: Array<{ market: string; category: BillingCategory; tierIndex: number; tierStart: number; tierEnd: number | null; label: string }>;
  checksum: string;
  issues: ImportIssue[];
  format: "json" | "csv-long" | "csv-wide";
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const JsonCardSchema = z.object({
  name: z.string().min(1),
  currency: z.string().length(3),
  effectiveFrom: z.string().regex(DATE),
  effectiveUntil: z.string().regex(DATE).nullable().optional(),
  sourceUrl: z.string().min(1),
  sourceDocument: z.string().min(1),
  isDemo: z.boolean().optional(),
  marketAliases: z.record(z.string(), z.array(z.string())).optional(),
  rates: z
    .array(
      z.object({
        market: z.string().min(1),
        category: z.string().min(1),
        tierStart: z.coerce.number().int().positive().optional(),
        tierEnd: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
        unitRate: z.union([z.string(), z.number()]),
      }),
    )
    .min(1),
});

const norm = (s: string) => s.toLowerCase().replace(/[\s\-_.()/]/g, "");

const CATEGORY_ALIASES: Record<string, BillingCategory> = {
  marketing: BillingCategory.MARKETING,
  marketinglite: BillingCategory.MARKETING_LITE,
  utility: BillingCategory.UTILITY,
  authentication: BillingCategory.AUTHENTICATION,
  auth: BillingCategory.AUTHENTICATION,
  authenticationinternational: BillingCategory.AUTHENTICATION_INTERNATIONAL,
  authinternational: BillingCategory.AUTHENTICATION_INTERNATIONAL,
  authenticationintl: BillingCategory.AUTHENTICATION_INTERNATIONAL,
  service: BillingCategory.SERVICE,
};

export function normalizeCategory(raw: string): BillingCategory | null {
  const upper = raw.trim().toUpperCase().replace(/[\s-]/g, "_");
  if ((BILLING_CATEGORIES as string[]).includes(upper)) return upper as BillingCategory;
  return CATEGORY_ALIASES[norm(raw)] ?? null;
}

const REGION_NAMES: Record<string, string> = {
  northamerica: Region.NORTH_AMERICA,
  restofafrica: Region.REST_OF_AFRICA,
  restofasiapacific: Region.REST_OF_ASIA_PACIFIC,
  restofcentraleasterneurope: Region.REST_OF_CENTRAL_EASTERN_EUROPE,
  restofcentralandeasterneurope: Region.REST_OF_CENTRAL_EASTERN_EUROPE,
  restofwesterneurope: Region.REST_OF_WESTERN_EUROPE,
  restoflatinamerica: Region.REST_OF_LATIN_AMERICA,
  restofmiddleeast: Region.REST_OF_MIDDLE_EAST,
  other: Region.OTHER,
};

const COUNTRY_NAMES: Record<string, string> = {
  argentina: "AR", brazil: "BR", brasil: "BR", chile: "CL", colombia: "CO", egypt: "EG", france: "FR", germany: "DE",
  hongkong: "HK", hungary: "HU", india: "IN", indonesia: "ID", israel: "IL", italy: "IT", malaysia: "MY", mexico: "MX",
  netherlands: "NL", nigeria: "NG", pakistan: "PK", peru: "PE", poland: "PL", qatar: "QA", romania: "RO", russia: "RU",
  saudiarabia: "SA", singapore: "SG", southafrica: "ZA", spain: "ES", turkey: "TR", turkiye: "TR",
  unitedarabemirates: "AE", uae: "AE", unitedkingdom: "GB", uk: "GB", bangladesh: "BD", iraq: "IQ", kazakhstan: "KZ",
  kuwait: "KW", morocco: "MA", nepal: "NP", oman: "OM", srilanka: "LK", ukraine: "UA",
};

const KNOWN_MARKETS = new Set<string>(MARKET_MAPPINGS.flatMap((v) => v.entries.map((e) => e.market)));

/** Market name/id as written in a rate card → WCO market id. Unknown names are kept upper-cased (DEMO groupings). */
export function normalizeMarket(raw: string): string {
  const key = norm(raw);
  if (REGION_NAMES[key]) return REGION_NAMES[key]!;
  if (COUNTRY_NAMES[key]) return COUNTRY_NAMES[key]!;
  const upper = raw.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (KNOWN_MARKETS.has(upper)) return upper;
  return upper;
}

function parseRate(raw: string | number, issues: ImportIssue[], row: number): Money | null {
  const s = String(raw).trim().replace(/[$€£R\s]/g, "").replace(/,(?=\d{3}\b)/g, "");
  if (s === "" || s === "-" || s.toLowerCase() === "n/a") return null;
  const cleaned = s.replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) {
    issues.push({ row, message: `Invalid rate "${raw}"` });
    return null;
  }
  return new Money(cleaned);
}

function parseIntOrNull(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim().replace(/[,\s]/g, "");
  if (s === "" || s === "-" || /^(inf|infinity|unbounded|null|\+)$/i.test(s)) return null;
  const n = Number(s.replace(/\+$/, ""));
  return Number.isInteger(n) ? n : null;
}

function finalize(
  meta: ImportMetadata,
  currency: string,
  rows: RateRow[],
  issues: ImportIssue[],
  format: ImportResult["format"],
  rawContent: string,
): ImportResult {
  const checksum = sha256Hex(rawContent);
  // Validate tier structure per (market, category).
  const groups = new Map<string, RateRow[]>();
  for (const r of rows) {
    const k = `${r.market}|${r.category}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const tiers: ImportResult["tiers"] = [];
  for (const [k, list] of groups) {
    try {
      const calc = new TierCalculator(list.map((r) => ({ start: r.tierStart, end: r.tierEnd, rate: r.unitRate })));
      if (list.length > 1) {
        const [market, category] = k.split("|") as [string, BillingCategory];
        calc.bands.forEach((b, i) => tiers.push({ market, category, tierIndex: i, tierStart: b.start, tierEnd: b.end, label: b.label ?? `Tier ${i}` }));
      }
    } catch (e) {
      issues.push({ message: `${k}: ${(e as Error).message}` });
    }
  }
  if (!DATE.test(meta.effectiveFrom)) issues.push({ message: "effectiveFrom must be YYYY-MM-DD" });
  if (meta.effectiveUntil && !DATE.test(meta.effectiveUntil)) issues.push({ message: "effectiveUntil must be YYYY-MM-DD" });
  if (!meta.sourceUrl) issues.push({ message: "sourceUrl is required (traceability)" });
  if (rows.length === 0) issues.push({ message: "No rate rows found" });

  const ok = issues.length === 0;
  let card: RateCard | undefined;
  if (ok) {
    const cardMeta: RateCardMeta = {
      id: `${meta.name}`,
      name: meta.name,
      currency,
      effectiveFrom: meta.effectiveFrom,
      effectiveUntil: meta.effectiveUntil ?? null,
      sourceUrl: meta.sourceUrl,
      sourceDocument: meta.sourceDocument,
      isDemo: meta.isDemo ?? false,
      checksum,
      marketAliases: meta.marketAliases ?? {},
    };
    card = new RateCard(cardMeta, rows);
  }
  return { ok, card, rows, tiers, checksum, issues, format };
}

export function importJson(content: string, overrides: Partial<ImportMetadata> = {}): ImportResult {
  const issues: ImportIssue[] = [];
  let parsed: z.infer<typeof JsonCardSchema>;
  try {
    const data = JSON.parse(content) as Record<string, unknown>;
    parsed = JsonCardSchema.parse({ ...data, ...stripUndefined(overrides) });
  } catch (e) {
    return { ok: false, rows: [], tiers: [], checksum: sha256Hex(content), issues: [{ message: (e as Error).message }], format: "json" };
  }
  const meta: ImportMetadata = { ...parsed, effectiveUntil: parsed.effectiveUntil ?? null };
  const rows: RateRow[] = [];
  parsed.rates.forEach((r, i) => {
    const category = normalizeCategory(r.category);
    if (!category) {
      issues.push({ row: i + 1, message: `Unknown category "${r.category}"` });
      return;
    }
    const rate = parseRate(r.unitRate, issues, i + 1);
    if (!rate) return;
    rows.push({
      market: normalizeMarket(r.market),
      currency: parsed.currency,
      category,
      tierStart: r.tierStart ?? 1,
      tierEnd: r.tierEnd ?? null,
      unitRate: rate,
      effectiveFrom: meta.effectiveFrom,
      effectiveUntil: meta.effectiveUntil ?? null,
    });
  });
  return finalize(meta, parsed.currency, rows, issues, "json", content);
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** CSV import. `tiersCsv` (long format) optionally adds volume tiers on top of a wide list-rate file. */
export function importCsv(content: string, meta: ImportMetadata, tiersCsv?: string): ImportResult {
  const issues: ImportIssue[] = [];
  let records: Array<Record<string, string>>;
  try {
    records = parse(content, { columns: true, skip_empty_lines: true, trim: true, bom: true }) as Array<Record<string, string>>;
  } catch (e) {
    return { ok: false, rows: [], tiers: [], checksum: sha256Hex(content), issues: [{ message: `CSV parse error: ${(e as Error).message}` }], format: "csv-long" };
  }
  if (records.length === 0) {
    return { ok: false, rows: [], tiers: [], checksum: sha256Hex(content), issues: [{ message: "Empty CSV" }], format: "csv-long" };
  }
  const headers = Object.keys(records[0]!);
  const h = (...names: string[]) => headers.find((x) => names.includes(norm(x)));
  const marketCol = h("market", "country", "region", "marketname", "countryregion");
  const currencyCol = h("currency");
  const categoryCol = h("category", "messagecategory", "pricingcategory");
  const isWide = !categoryCol && headers.some((x) => normalizeCategory(x) !== null);
  const format: ImportResult["format"] = isWide ? "csv-wide" : "csv-long";
  if (!marketCol) issues.push({ message: `No market column (found: ${headers.join(", ")})` });

  const rows: RateRow[] = [];
  let currency = meta.currency;
  const until = meta.effectiveUntil ?? null;

  records.forEach((rec, i) => {
    const rowNo = i + 2;
    if (!marketCol) return;
    const market = normalizeMarket(rec[marketCol] ?? "");
    const cur = (currencyCol ? rec[currencyCol] : meta.currency)?.trim().toUpperCase();
    if (!cur) {
      issues.push({ row: rowNo, message: "Missing currency (column or --currency)" });
      return;
    }
    if (currency && cur !== currency) {
      issues.push({ row: rowNo, message: `Mixed currencies in one rate card (${currency} vs ${cur})` });
      return;
    }
    currency = cur;
    if (isWide) {
      for (const col of headers) {
        const category = normalizeCategory(col);
        if (!category || col === marketCol || col === currencyCol) continue;
        const rate = parseRate(rec[col] ?? "", issues, rowNo);
        if (rate) rows.push({ market, currency: cur, category, tierStart: 1, tierEnd: null, unitRate: rate, effectiveFrom: meta.effectiveFrom, effectiveUntil: until });
      }
    } else {
      const category = normalizeCategory(rec[categoryCol!] ?? "");
      if (!category) {
        issues.push({ row: rowNo, message: `Unknown category "${rec[categoryCol!]}"` });
        return;
      }
      const startCol = h("tierstart", "from", "start", "volumefrom");
      const endCol = h("tierend", "to", "end", "volumeto");
      const rateCol = h("unitrate", "rate", "price", "rateperdeliveredmessage");
      if (!rateCol) {
        issues.push({ row: rowNo, message: "No rate column (unit_rate/rate/price)" });
        return;
      }
      const rate = parseRate(rec[rateCol] ?? "", issues, rowNo);
      if (!rate) return;
      const effFromCol = h("effectivefrom");
      const effUntilCol = h("effectiveuntil");
      rows.push({
        market,
        currency: cur,
        category,
        tierStart: (startCol ? parseIntOrNull(rec[startCol]) : null) ?? 1,
        tierEnd: endCol ? parseIntOrNull(rec[endCol]) : null,
        unitRate: rate,
        effectiveFrom: (effFromCol && rec[effFromCol]) || meta.effectiveFrom,
        effectiveUntil: (effUntilCol && rec[effUntilCol]) || until,
      });
    }
  });

  if (tiersCsv) {
    const tierResult = importCsv(tiersCsv, { ...meta, currency });
    issues.push(...tierResult.issues.map((x) => ({ ...x, message: `[tiers] ${x.message}` })));
    const tiered = new Set(tierResult.rows.map((r) => `${r.market}|${r.category}`));
    // Volume-tier rows replace the single list-rate row of the same (market, category).
    for (let i = rows.length - 1; i >= 0; i--) if (tiered.has(`${rows[i]!.market}|${rows[i]!.category}`)) rows.splice(i, 1);
    rows.push(...tierResult.rows);
  }

  return finalize({ ...meta, currency }, currency ?? "XXX", rows, issues, format, content + (tiersCsv ?? ""));
}

/** Detects format by content. */
export function importRateCard(content: string, meta: Partial<ImportMetadata>, tiersCsv?: string): ImportResult {
  const trimmed = content.trimStart();
  if (trimmed.startsWith("{")) return importJson(content, meta);
  if (!meta.name || !meta.effectiveFrom || !meta.sourceUrl || !meta.sourceDocument) {
    return {
      ok: false,
      rows: [],
      tiers: [],
      checksum: sha256Hex(content),
      issues: [{ message: "CSV imports require name, effectiveFrom, sourceUrl and sourceDocument metadata" }],
      format: "csv-long",
    };
  }
  return importCsv(content, meta as ImportMetadata, tiersCsv);
}
