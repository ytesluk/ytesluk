/** Number formatting (pt-BR), with nothing else in the module: safe to ship on the public product page. */
export function money(v: string | number | null | undefined, currency = "BRL", digits = 2): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, n !== 0 && Math.abs(n) < 0.01 ? 4 : digits) });
}

export function int(v: number | string | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}
