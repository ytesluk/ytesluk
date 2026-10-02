/**
 * Timezone helpers. All timestamps are stored and computed in UTC (spec §87). The only places where a
 * local calendar is needed are the ones Meta itself defines in WABA time:
 *  - effective dates of rate cards/policies ("as of 12am by WhatsApp Business Account timezone");
 *  - monthly reset of volume tiers ("12am WABA timezone") and of free quotas.
 * Implemented with Intl only (no external tz library).
 */

export interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = dtfCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    dtfCache.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

export function localParts(instant: Date, timeZone: string): LocalParts {
  const parts = formatter(timeZone).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/**
 * Offset cache: timezone offsets only change on whole-hour or half-hour boundaries (DST/legislation), so the
 * offset of the 15-minute bucket containing an instant is cached. Avoids Intl.formatToParts in hot paths
 * (pricing evaluations in 1M-event simulations).
 */
const offsetCache = new Map<string, Map<number, number>>();
const BUCKET_MS = 15 * 60_000;

function cachedOffsetMs(instant: Date, timeZone: string): number {
  let byBucket = offsetCache.get(timeZone);
  if (!byBucket) {
    byBucket = new Map();
    offsetCache.set(timeZone, byBucket);
  }
  const bucket = Math.floor(instant.getTime() / BUCKET_MS);
  let off = byBucket.get(bucket);
  if (off === undefined) {
    off = tzOffsetMs(new Date(bucket * BUCKET_MS), timeZone);
    if (byBucket.size > 200_000) byBucket.clear();
    byBucket.set(bucket, off);
  }
  return off;
}

/** Local calendar date (YYYY-MM-DD) of a UTC instant in a timezone. */
const dayStringCache = new Map<number, string>();

export function localDate(instant: Date, timeZone: string): string {
  const shifted = timeZone === "UTC" ? instant.getTime() : instant.getTime() + cachedOffsetMs(instant, timeZone);
  const dayNum = Math.floor(shifted / 86_400_000);
  let s = dayStringCache.get(dayNum);
  if (s === undefined) {
    s = new Date(dayNum * 86_400_000).toISOString().slice(0, 10);
    dayStringCache.set(dayNum, s);
  }
  return s;
}

/** Billing month key (YYYY-MM) in the WABA timezone. */
export function billingMonth(instant: Date, timeZone: string): string {
  return localDate(instant, timeZone).slice(0, 7);
}

/** Offset (ms) of a timezone at a given instant: local wall time − UTC. */
function tzOffsetMs(instant: Date, timeZone: string): number {
  const p = localParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** UTC instant of a local wall-clock time in a timezone (handles DST by iterating twice). */
export function zonedToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  let offset = tzOffsetMs(new Date(guess), timeZone);
  let result = guess - offset;
  const offset2 = tzOffsetMs(new Date(result), timeZone);
  if (offset2 !== offset) {
    offset = offset2;
    result = guess - offset;
  }
  return new Date(result);
}

/** [start, end) of the local month containing `instant`, as UTC instants. */
export function monthBoundsUtc(instant: Date, timeZone: string): { start: Date; end: Date; key: string } {
  const p = localParts(instant, timeZone);
  const start = zonedToUtc(p.year, p.month, 1, 0, 0, timeZone);
  const nextYear = p.month === 12 ? p.year + 1 : p.year;
  const nextMonth = p.month === 12 ? 1 : p.month + 1;
  const end = zonedToUtc(nextYear, nextMonth, 1, 0, 0, timeZone);
  return { start, end, key: `${pad(p.year, 4)}-${pad(p.month)}` };
}

export function addHours(d: Date, hours: number): Date {
  return new Date(d.getTime() + hours * 3_600_000);
}

export function addSeconds(d: Date, seconds: number): Date {
  return new Date(d.getTime() + seconds * 1000);
}

export function maxDate(...dates: Array<Date | null | undefined>): Date | null {
  let m: Date | null = null;
  for (const d of dates) if (d && (!m || d > m)) m = d;
  return m;
}

export function minDate(...dates: Array<Date | null | undefined>): Date | null {
  let m: Date | null = null;
  for (const d of dates) if (d && (!m || d < m)) m = d;
  return m;
}

/** Date-only string (YYYY-MM-DD) → comparable; used for policy effectiveFrom/Until (local WABA dates). */
export function isWithinLocalDates(date: string, from: string, until: string | null | undefined): boolean {
  return date >= from && (until === null || until === undefined || date <= until);
}

export const DEFAULT_TIMEZONE = "UTC";
