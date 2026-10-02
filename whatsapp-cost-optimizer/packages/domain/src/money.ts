import Decimal from "decimal.js";

/**
 * Money is always handled with arbitrary-precision decimals (never JS floats).
 * Persistence uses PostgreSQL numeric(18,8).
 */
export const Money = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });
export type Money = Decimal;
export { Decimal };

export const MONEY_SCALE = 8;

export type MoneyInput = Decimal.Value | { toString(): string };

export function money(value: MoneyInput | null | undefined): Decimal {
  if (value === null || value === undefined) return new Money(0);
  if (value instanceof Decimal) return new Money(value);
  if (typeof value === "number" || typeof value === "string") return new Money(value);
  return new Money(value.toString());
}

export const ZERO = new Money(0);

export function sumMoney(values: Iterable<MoneyInput>): Decimal {
  let acc = new Money(0);
  for (const v of values) acc = acc.plus(money(v));
  return acc;
}

/** Fixed representation for storage (numeric(18,8)). */
export function toStorage(value: MoneyInput): string {
  return money(value).toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_EVEN).toFixed(MONEY_SCALE);
}

/** Percentage (0-100) with safe division; returns null when the base is zero. */
export function percentage(part: MoneyInput, whole: MoneyInput, dp = 2): Decimal | null {
  const w = money(whole);
  if (w.isZero()) return null;
  return money(part).dividedBy(w).times(100).toDecimalPlaces(dp);
}

/** Presentation-only formatting. Never use the output for arithmetic. */
export function formatMoney(value: MoneyInput, currency: string, locale = "pt-BR", maxFractionDigits = 2): string {
  const n = money(value).toDecimalPlaces(Math.max(maxFractionDigits, 2)).toNumber();
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: maxFractionDigits,
  }).format(n);
}
