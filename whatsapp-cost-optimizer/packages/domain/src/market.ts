/**
 * Versioned mapping "recipient country calling code → Meta pricing market" (docs/META-SOURCES.md, S1).
 *
 * Meta: "Charges for messages are based on the country calling code of the recipient WhatsApp
 * phone number. [...] If a country is not listed below, it maps to Other."
 *
 * The market is NEVER derived from the business country (spec §89). The mapping is data with an
 * effective date (local calendar date in the WABA timezone), because Meta moves markets between
 * regions on quarter starts.
 */

export const Region = {
  NORTH_AMERICA: "NORTH_AMERICA",
  REST_OF_AFRICA: "REST_OF_AFRICA",
  REST_OF_ASIA_PACIFIC: "REST_OF_ASIA_PACIFIC",
  REST_OF_CENTRAL_EASTERN_EUROPE: "REST_OF_CENTRAL_EASTERN_EUROPE",
  REST_OF_WESTERN_EUROPE: "REST_OF_WESTERN_EUROPE",
  REST_OF_LATIN_AMERICA: "REST_OF_LATIN_AMERICA",
  REST_OF_MIDDLE_EAST: "REST_OF_MIDDLE_EAST",
  OTHER: "OTHER",
} as const;
export type Region = (typeof Region)[keyof typeof Region];

export interface MarketMappingEntry {
  /** Digits of the E.164 number prefix (country calling code, optionally + network prefix). */
  prefix: string;
  /** Pricing market id (ISO alpha-2 for standalone markets, Region id otherwise). */
  market: string;
  /** ISO 3166 alpha-2 of the country owning the prefix (informational). */
  iso?: string;
}

export interface MarketMappingVersion {
  id: string;
  /** Local calendar date (YYYY-MM-DD) in the WABA timezone. */
  effectiveFrom: string;
  sourceUrl: string;
  notes: string;
  entries: MarketMappingEntry[];
}

const SOURCE = "https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/";

type CountryRow = [iso: string, prefix: string];

const STANDALONE_2026_07: CountryRow[] = [
  ["AR", "54"], ["BR", "55"], ["CL", "56"], ["CO", "57"], ["EG", "20"], ["FR", "33"], ["DE", "49"],
  ["HK", "852"], ["HU", "36"], ["IN", "91"], ["ID", "62"], ["IL", "972"], ["IT", "39"], ["MY", "60"],
  ["MX", "52"], ["NL", "31"], ["NG", "234"], ["PK", "92"], ["PE", "51"], ["PL", "48"], ["QA", "974"],
  ["RO", "40"], ["RU", "7"], ["SA", "966"], ["SG", "65"], ["ZA", "27"], ["ES", "34"], ["TR", "90"],
  ["AE", "971"], ["GB", "44"],
];

const REST_OF_AFRICA: CountryRow[] = [
  ["DZ", "213"], ["AO", "244"], ["BJ", "229"], ["BW", "267"], ["BF", "226"], ["BI", "257"], ["CM", "237"],
  ["TD", "235"], ["CG", "242"], ["ER", "291"], ["ET", "251"], ["GA", "241"], ["GM", "220"], ["GH", "233"],
  ["GW", "245"], ["CI", "225"], ["KE", "254"], ["LS", "266"], ["LR", "231"], ["LY", "218"], ["MG", "261"],
  ["MW", "265"], ["ML", "223"], ["MR", "222"], ["MA", "212"], ["MZ", "258"], ["NA", "264"], ["NE", "227"],
  ["RW", "250"], ["SN", "221"], ["SL", "232"], ["SO", "252"], ["SS", "211"], ["SD", "249"], ["SZ", "268"],
  ["TZ", "255"], ["TG", "228"], ["TN", "216"], ["UG", "256"], ["ZM", "260"], ["ZW", "263"],
];

const REST_OF_ASIA_PACIFIC: CountryRow[] = [
  ["AF", "93"], ["AU", "61"], ["BD", "880"], ["KH", "855"], ["CN", "86"], ["JP", "81"], ["LA", "856"],
  ["MN", "976"], ["NP", "977"], ["NZ", "64"], ["PG", "675"], ["PH", "63"], ["LK", "94"], ["TW", "886"],
  ["TJ", "992"], ["TH", "66"], ["TM", "993"], ["UZ", "998"], ["VN", "84"],
];

const REST_OF_CEE: CountryRow[] = [
  ["AL", "355"], ["AM", "374"], ["AZ", "994"], ["BY", "375"], ["BG", "359"], ["HR", "385"], ["CZ", "420"],
  ["GE", "995"], ["GR", "30"], ["LV", "371"], ["LT", "370"], ["MD", "373"], ["MK", "389"], ["RS", "381"],
  ["SK", "421"], ["SI", "386"], ["UA", "380"],
];

const REST_OF_WESTERN_EUROPE: CountryRow[] = [
  ["AT", "43"], ["BE", "32"], ["DK", "45"], ["FI", "358"], ["IE", "353"], ["NO", "47"], ["PT", "351"],
  ["SE", "46"], ["CH", "41"],
];

const REST_OF_LATAM: CountryRow[] = [
  ["BO", "591"], ["CR", "506"], ["DO", "1809"], ["DO", "1829"], ["DO", "1849"], ["EC", "593"], ["SV", "503"],
  ["GT", "502"], ["HT", "509"], ["HN", "504"], ["JM", "1658"], ["JM", "1876"], ["NI", "505"], ["PA", "507"],
  ["PY", "595"], ["PR", "1787"], ["PR", "1939"], ["UY", "598"], ["VE", "58"],
];

const REST_OF_MIDDLE_EAST: CountryRow[] = [
  ["BH", "973"], ["IQ", "964"], ["JO", "962"], ["KW", "965"], ["LB", "961"], ["OM", "968"], ["YE", "967"],
];

/**
 * NANP (+1) area codes that belong to countries NOT listed by Meta → "Other".
 * Without these, any +1 number would wrongly resolve to North America.
 */
const NANP_OTHER: CountryRow[] = [
  ["BS", "1242"], ["BB", "1246"], ["AI", "1264"], ["AG", "1268"], ["VG", "1284"], ["KY", "1345"],
  ["BM", "1441"], ["GD", "1473"], ["TC", "1649"], ["MS", "1664"], ["SX", "1721"], ["LC", "1758"],
  ["DM", "1767"], ["VC", "1784"], ["TT", "1868"], ["KN", "1869"],
];

function rows(list: CountryRow[], market: (iso: string) => string): MarketMappingEntry[] {
  return list.map(([iso, prefix]) => ({ iso, prefix, market: market(iso) }));
}

function build(overrides: {
  standalone: CountryRow[];
  regional: Array<[Region, CountryRow[]]>;
  extra?: MarketMappingEntry[];
}): MarketMappingEntry[] {
  const out: MarketMappingEntry[] = [
    ...rows(overrides.standalone, (iso) => iso),
    { prefix: "1", market: Region.NORTH_AMERICA, iso: "US" },
    ...rows(NANP_OTHER, () => Region.OTHER),
  ];
  for (const [region, list] of overrides.regional) out.push(...rows(list, () => region));
  if (overrides.extra) out.push(...overrides.extra);
  return out;
}

const minus = (list: CountryRow[], isos: string[]) => list.filter(([iso]) => !isos.includes(iso));

/** Markets moved out of "Rest of" regions on 2026-07-01 (S1, "Previous rate card updates"). */
const STANDALONE_SINCE_2026_07 = ["HK", "HU", "PL", "QA", "RO", "SG"];
/** Markets moved out of "Rest of" regions on 2026-10-01 (S1, "Rate card updates effective October 1, 2026"). */
const STANDALONE_SINCE_2026_10 = ["BD", "IQ", "KW", "MA", "NP", "OM", "LK", "UA"];

export const MARKET_MAPPINGS: MarketMappingVersion[] = [
  {
    id: "meta-markets-2025-07",
    effectiveFrom: "2025-07-01",
    sourceUrl: SOURCE,
    notes:
      "Pre-2026-07 regional placement of HK, HU, PL, QA, RO, SG. Poland → Rest of Central and Eastern Europe is " +
      "explicit in the source; the other five are inferred geographically (the source only says they were moved " +
      "out of 'their respective Rest Of pricing region').",
    entries: build({
      standalone: minus(STANDALONE_2026_07, STANDALONE_SINCE_2026_07),
      regional: [
        [Region.REST_OF_AFRICA, REST_OF_AFRICA],
        [Region.REST_OF_ASIA_PACIFIC, [...REST_OF_ASIA_PACIFIC, ["HK", "852"], ["SG", "65"]]],
        [Region.REST_OF_CENTRAL_EASTERN_EUROPE, [...REST_OF_CEE, ["HU", "36"], ["PL", "48"], ["RO", "40"]]],
        [Region.REST_OF_WESTERN_EUROPE, REST_OF_WESTERN_EUROPE],
        [Region.REST_OF_LATIN_AMERICA, REST_OF_LATAM],
        [Region.REST_OF_MIDDLE_EAST, [...REST_OF_MIDDLE_EAST, ["QA", "974"]]],
      ],
    }),
  },
  {
    id: "meta-markets-2026-07",
    effectiveFrom: "2026-07-01",
    sourceUrl: SOURCE,
    notes: "Country calling code table as published on the pricing page (rate cards effective 2026-07-01).",
    entries: build({
      standalone: STANDALONE_2026_07,
      regional: [
        [Region.REST_OF_AFRICA, REST_OF_AFRICA],
        [Region.REST_OF_ASIA_PACIFIC, REST_OF_ASIA_PACIFIC],
        [Region.REST_OF_CENTRAL_EASTERN_EUROPE, REST_OF_CEE],
        [Region.REST_OF_WESTERN_EUROPE, REST_OF_WESTERN_EUROPE],
        [Region.REST_OF_LATIN_AMERICA, REST_OF_LATAM],
        [Region.REST_OF_MIDDLE_EAST, REST_OF_MIDDLE_EAST],
      ],
    }),
  },
  {
    id: "meta-markets-2026-10",
    effectiveFrom: "2026-10-01",
    sourceUrl: SOURCE,
    notes:
      "9 markets become standalone (BD, IQ, KZ, KW, MA, NP, OM, LK, UA). Kazakhstan shares +7 with Russia; " +
      "KZ is resolved by the +7 6xx / +7 7xx national prefixes (assumption, see KNOWN-CONFLICTS).",
    entries: build({
      standalone: [
        ...STANDALONE_2026_07,
        ["BD", "880"], ["IQ", "964"], ["KW", "965"], ["MA", "212"], ["NP", "977"], ["OM", "968"],
        ["LK", "94"], ["UA", "380"], ["KZ", "76"], ["KZ", "77"],
      ],
      regional: [
        [Region.REST_OF_AFRICA, minus(REST_OF_AFRICA, STANDALONE_SINCE_2026_10)],
        [Region.REST_OF_ASIA_PACIFIC, minus(REST_OF_ASIA_PACIFIC, STANDALONE_SINCE_2026_10)],
        [Region.REST_OF_CENTRAL_EASTERN_EUROPE, minus(REST_OF_CEE, STANDALONE_SINCE_2026_10)],
        [Region.REST_OF_WESTERN_EUROPE, REST_OF_WESTERN_EUROPE],
        [Region.REST_OF_LATIN_AMERICA, REST_OF_LATAM],
        [Region.REST_OF_MIDDLE_EAST, minus(REST_OF_MIDDLE_EAST, STANDALONE_SINCE_2026_10)],
      ],
    }),
  },
];

export interface ResolvedMarket {
  market: string;
  iso?: string;
  callingCodePrefix?: string;
  mappingVersion: string;
}

/** Picks the mapping version effective on a local billing date (YYYY-MM-DD). */
export function marketMappingFor(billingDate: string, versions: MarketMappingVersion[] = MARKET_MAPPINGS): MarketMappingVersion {
  const sorted = [...versions].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  let chosen = sorted[0];
  for (const v of sorted) if (v.effectiveFrom <= billingDate) chosen = v;
  if (!chosen) throw new Error("No market mapping configured");
  return chosen;
}

const indexCache = new WeakMap<MarketMappingVersion, Map<string, MarketMappingEntry>>();

function indexOf(version: MarketMappingVersion): Map<string, MarketMappingEntry> {
  let idx = indexCache.get(version);
  if (!idx) {
    idx = new Map(version.entries.map((e) => [e.prefix, e]));
    indexCache.set(version, idx);
  }
  return idx;
}

/** Longest-prefix match of an E.164 number against the mapping effective on `billingDate`. */
export function resolveMarket(e164: string, billingDate: string, versions?: MarketMappingVersion[]): ResolvedMarket {
  const version = marketMappingFor(billingDate, versions);
  const digits = e164.replace(/\D/g, "");
  const idx = indexOf(version);
  for (let len = Math.min(4, digits.length); len >= 1; len--) {
    const entry = idx.get(digits.slice(0, len));
    if (entry) return { market: entry.market, iso: entry.iso, callingCodePrefix: entry.prefix, mappingVersion: version.id };
  }
  return { market: Region.OTHER, mappingVersion: version.id };
}
