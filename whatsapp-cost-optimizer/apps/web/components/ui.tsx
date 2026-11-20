"use client";

import { AlertTriangle, CheckCircle2, Info, Loader2, OctagonAlert } from "lucide-react";
import type { ApiError } from "@/lib/api";

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-display text-[28px] font-semibold leading-tight tracking-tight text-ink">{title}</h1>
        {description ? <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-ink-2">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({ title, subtitle, actions, children, className, padded = true }: { title?: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={cx("rounded-2xl border border-line bg-surface", className)}>
      {title || actions ? (
        <header className="perf-b flex flex-wrap items-start justify-between gap-3 px-5 py-4">
          <div className="min-w-0">
            {title ? <h2 className="font-display text-[15px] font-semibold tracking-tight text-ink">{title}</h2> : null}
            {subtitle ? <p className="mt-0.5 text-xs leading-relaxed text-muted">{subtitle}</p> : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={padded ? "p-5" : undefined}>{children}</div>
    </section>
  );
}

/** Stat tile: one headline number, a label, and an optional comparison line (no chart). */
export function Kpi({ label, value, hint, tone, badge }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "good" | "neutral"; badge?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-ink-2">{label}</p>
        {badge}
      </div>
      <p className="figure mt-2 text-2xl font-semibold text-ink">{tone === "good" ? <span className="marker">{value}</span> : value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export type BadgeTone = "neutral" | "info" | "good" | "warning" | "critical" | "demo";
const BADGE: Record<BadgeTone, string> = {
  neutral: "bg-surface-2 text-ink-2 border-transparent",
  info: "bg-transparent text-ink-2 border-rule border-dashed",
  good: "bg-accent text-accent-ink border-transparent",
  warning: "bg-transparent text-ink border-[var(--warning)]",
  critical: "bg-transparent text-critical border-[var(--critical)]",
  demo: "bg-[var(--demo-bg)] text-[var(--demo-ink)] border-transparent",
};

export function Badge({ tone = "neutral", children, title }: { tone?: BadgeTone; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 font-mono text-[10px] font-medium uppercase leading-4 tracking-wide", BADGE[tone])}>
      {children}
    </span>
  );
}

export function DemoBadge() {
  return (
    <Badge tone="demo" title="Valores fictícios para desenvolvimento e simulação — não são tarifas da Meta">
      TARIFAS DEMO
    </Badge>
  );
}

export function ConfidenceBadge({ value }: { value: string | null | undefined }) {
  if (!value) return <Badge>—</Badge>;
  if (value === "REALIZED") return <Badge tone="good" title="Confirmado pela Meta nos webhooks de entrega">REALIZADO</Badge>;
  if (value === "UNKNOWN") return <Badge tone="warning">DESCONHECIDO</Badge>;
  return <Badge tone="info" title="Estimativa do WCO, ainda não confirmada pela Meta">ESTIMADO</Badge>;
}

export function Button({ variant = "secondary", className, loading, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; loading?: boolean }) {
  const styles = {
    primary: "bg-accent text-accent-ink hover:opacity-90 border-transparent",
    secondary: "bg-surface text-ink border-rule hover:bg-surface-2",
    ghost: "bg-transparent text-ink-2 border-transparent hover:bg-surface-2",
    danger: "bg-surface text-critical border-[var(--critical)] hover:bg-surface-2",
  }[variant];
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={cx("inline-flex h-9 items-center justify-center gap-1.5 rounded-[10px] border px-3.5 text-sm font-semibold transition active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50", styles, className)}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1 block text-xs font-medium text-ink-2">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-muted">{hint}</span> : null}
    </label>
  );
}

const control = "rounded-[10px] border border-rule bg-receipt px-3 py-2 text-sm text-ink placeholder:text-muted";

/** Controls fill their container unless the caller sets an explicit width (w-*). */
const width = (className?: string) => (/(^|\s)w-/.test(className ?? "") ? undefined : "w-full");

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(control, width(props.className), "h-9 py-0", props.className)} />;
}

export function Select({ children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cx(control, width(props.className), "h-9 py-0", props.className)}>
      {children}
    </select>
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(control, width(props.className), "font-mono text-xs", props.className)} />;
}

export function Loading({ label = "Carregando…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-muted" role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden /> {label}
    </div>
  );
}

export function ErrorBox({ error, title = "Não foi possível carregar" }: { error: ApiError | Error | null; title?: string }) {
  if (!error) return null;
  const status = (error as ApiError).status;
  const forbidden = status === 403;
  return (
    <div role="alert" className="flex items-start gap-3 rounded-2xl border border-[var(--critical)] bg-surface p-4 text-sm">
      <OctagonAlert className="mt-0.5 size-4 shrink-0 text-critical" aria-hidden />
      <div>
        <p className="font-medium text-ink">{forbidden ? "Sem permissão para esta área" : title}</p>
        <p className="mt-0.5 text-ink-2">{forbidden ? "Seu papel (role) não tem acesso a este recurso." : error.message}</p>
        {(error as ApiError).requestId ? <p className="mt-1 font-mono text-[11px] text-muted">request-id: {(error as ApiError).requestId}</p> : null}
      </div>
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warning" | "good"; children: React.ReactNode }) {
  const Icon = tone === "warning" ? AlertTriangle : tone === "good" ? CheckCircle2 : Info;
  const color = tone === "warning" ? "text-serious" : tone === "good" ? "text-good" : "text-accent";
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-dashed border-rule bg-surface px-4 py-3 text-sm leading-relaxed text-ink-2">
      <Icon className={cx("mt-0.5 size-4 shrink-0", color)} aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-8 text-center text-sm text-muted">{children}</p>;
}

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  render: (row: T) => React.ReactNode;
  align?: "left" | "right";
  className?: string;
}

export function Table<T>({ columns, rows, rowKey, empty = "Nenhum registro.", dense }: { columns: Column<T>[]; rows: T[]; rowKey: (row: T, i: number) => string; empty?: React.ReactNode; dense?: boolean }) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="perf-b text-left font-mono text-[10.5px] uppercase tracking-wider text-muted">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cx("whitespace-nowrap px-4 py-2.5 font-medium", c.align === "right" && "text-right", c.className)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={rowKey(r, i)} className="border-b border-dashed border-line last:border-0 hover:bg-surface-2/60">
              {columns.map((c) => (
                <td key={c.key} className={cx("px-4 align-top text-ink", dense ? "py-1.5" : "py-3", c.align === "right" && "tabular text-right text-[13px]", c.className)}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function KeyValue({ items, cols = 2 }: { items: Array<[string, React.ReactNode]>; cols?: 1 | 2 }) {
  return (
    <dl className={cx("grid grid-cols-1 gap-x-6 gap-y-2 text-sm", cols === 2 && "sm:grid-cols-2")}>
      {items.map(([k, v]) => (
        <div key={k} className="flex min-w-0 justify-between gap-3 border-b border-dashed border-line py-1.5">
          {/* Labels wrap between words; values keep their natural width (up to 65%) so numbers never split. */}
          <dt className="min-w-0 text-ink-2">{k}</dt>
          <dd className="max-w-[65%] shrink-0 break-words text-right text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Tabs<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string }> }) {
  return (
    <div role="tablist" className="inline-flex rounded-full border border-rule bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx("rounded-full px-3 py-1 text-xs font-semibold", value === o.value ? "bg-ink text-page" : "text-ink-2 hover:text-ink")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Price tag: what the message would have cost, struck through, next to what it cost.
 * `from` is only shown when it is higher than `to` (otherwise there is nothing to compare).
 */
export function PriceTag({ from, to, size = "sm" }: { from?: string | null; to: string; size?: "sm" | "lg" }) {
  return (
    <span className={cx("figure inline-flex flex-wrap items-baseline justify-end gap-x-2", size === "lg" ? "text-2xl font-semibold" : "text-[13px]")}>
      {from ? <span className={cx("struck font-normal", size === "lg" ? "text-base" : "text-[11px]")}>{from}</span> : null}
      <span className="text-ink">{to}</span>
    </span>
  );
}

/** One line of a statement: label on the left, dotted leader, figure on the right. */
export function ReceiptLine({ label, value, note, strong, highlight }: { label: React.ReactNode; value: React.ReactNode; note?: React.ReactNode; strong?: boolean; highlight?: boolean }) {
  return (
    <div className="py-1">
      <div className={cx("flex items-baseline gap-2", strong ? "text-[13px] font-semibold text-ink" : "text-[12.5px] text-ink-2")}>
        <span className="min-w-0">{label}</span>
        <span className="mb-1 min-w-4 flex-1 border-b border-dotted border-rule" aria-hidden />
        <span className="figure whitespace-nowrap text-ink">{highlight ? <span className="marker">{value}</span> : value}</span>
      </div>
      {note ? <p className="mt-0.5 text-[11px] leading-snug text-muted">{note}</p> : null}
    </div>
  );
}

export { cx };
