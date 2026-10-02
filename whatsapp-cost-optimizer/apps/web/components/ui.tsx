"use client";

import { AlertTriangle, CheckCircle2, Info, Loader2, OctagonAlert } from "lucide-react";
import type { ApiError } from "@/lib/api";

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-sm text-ink-2">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({ title, subtitle, actions, children, className, padded = true }: { title?: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={cx("rounded-xl border border-line bg-surface", className)}>
      {title || actions ? (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            {title ? <h2 className="text-sm font-semibold text-ink">{title}</h2> : null}
            {subtitle ? <p className="mt-0.5 text-xs text-muted">{subtitle}</p> : null}
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
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-ink-2">{label}</p>
        {badge}
      </div>
      <p className={cx("mt-2 text-2xl font-semibold tracking-tight", tone === "good" ? "text-good" : "text-ink")}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

type BadgeTone = "neutral" | "info" | "good" | "warning" | "critical" | "demo";
const BADGE: Record<BadgeTone, string> = {
  neutral: "bg-surface-2 text-ink-2 border-line",
  info: "bg-surface-2 text-accent border-line",
  good: "bg-surface-2 text-good border-line",
  warning: "bg-surface-2 text-ink border-[var(--warning)]",
  critical: "bg-surface-2 text-critical border-[var(--critical)]",
  demo: "bg-[var(--demo-bg)] text-[var(--demo-ink)] border-transparent",
};

export function Badge({ tone = "neutral", children, title }: { tone?: BadgeTone; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-4", BADGE[tone])}>
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
  if (value === "REALIZED") return <Badge tone="good">REALIZADO</Badge>;
  if (value === "UNKNOWN") return <Badge tone="warning">DESCONHECIDO</Badge>;
  return <Badge tone="info">ESTIMADO</Badge>;
}

const STATUS_TONE: Record<string, BadgeTone> = {
  DELIVERED: "good",
  READ: "good",
  SENT: "info",
  FAILED: "critical",
  BLOCKED: "critical",
  CANCELLED: "warning",
  DEDUPLICATED: "neutral",
  SUPERSEDED: "neutral",
  CONSOLIDATED: "neutral",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "info"}>{label ?? status}</Badge>;
}

export function Button({ variant = "secondary", className, loading, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; loading?: boolean }) {
  const styles = {
    primary: "bg-accent text-white hover:opacity-90 border-transparent",
    secondary: "bg-surface text-ink border-line hover:bg-surface-2",
    ghost: "bg-transparent text-ink-2 border-transparent hover:bg-surface-2",
    danger: "bg-surface text-critical border-[var(--critical)] hover:bg-surface-2",
  }[variant];
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={cx("inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50", styles, className)}
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

const control = "rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted";

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
    <div role="alert" className="flex items-start gap-3 rounded-xl border border-[var(--critical)] bg-surface p-4 text-sm">
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
    <div className="flex items-start gap-2.5 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm text-ink-2">
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
          <tr className="border-b border-line text-left text-xs text-ink-2">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cx("whitespace-nowrap px-3 py-2 font-medium", c.align === "right" && "text-right", c.className)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={rowKey(r, i)} className="border-b border-line last:border-0 hover:bg-surface-2">
              {columns.map((c) => (
                <td key={c.key} className={cx("px-3 align-top text-ink", dense ? "py-1.5" : "py-2.5", c.align === "right" && "tabular text-right", c.className)}>
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
        <div key={k} className="flex min-w-0 justify-between gap-3 border-b border-line py-1.5">
          <dt className="shrink-0 text-ink-2">{k}</dt>
          <dd className="min-w-0 break-words text-right text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Tabs<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string }> }) {
  return (
    <div role="tablist" className="inline-flex rounded-lg border border-line bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx("rounded-md px-3 py-1.5 text-xs font-medium", value === o.value ? "bg-surface-2 text-ink" : "text-ink-2 hover:text-ink")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export { cx };
