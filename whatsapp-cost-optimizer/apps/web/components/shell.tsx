"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Activity,
  Bell,
  BookOpenCheck,
  Calculator,
  CreditCard,
  FileText,
  FlaskConical,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Monitor,
  Moon,
  PiggyBank,
  Plug,
  SlidersHorizontal,
  Sun,
  Tags,
  X,
} from "lucide-react";
import { useApi } from "@/lib/api";
import { money } from "@/lib/format";
import type { Me } from "@/lib/server";
import { Wordmark } from "./brand";
import { rangeQuery } from "./range";
import { cx } from "./ui";

type Role = Me["actor"]["role"];
const ALL: Role[] = ["OWNER", "ADMIN", "ANALYST", "OPERATOR"];
const CONFIG: Role[] = ["OWNER", "ADMIN"];
const ANALYTICS: Role[] = ["OWNER", "ADMIN", "ANALYST"];

/** Navigation mirrors the API's RBAC (the API re-checks every request; hiding is only UX). */
const NAV: Array<{ section: string; platform?: boolean; items: Array<{ href: string; label: string; icon: React.ComponentType<{ className?: string }>; roles: Role[] }> }> = [
  {
    section: "Operação",
    items: [
      { href: "/", label: "Visão geral", icon: LayoutDashboard, roles: ANALYTICS },
      { href: "/admin/providers", label: "Conectar WhatsApp", icon: Plug, roles: CONFIG },
      { href: "/alerts", label: "Alertas", icon: Bell, roles: ANALYTICS },
    ],
  },
  {
    section: "Economias",
    items: [{ href: "/savings", label: "Economia de juntar mensagens", icon: PiggyBank, roles: CONFIG }],
  },
  {
    section: "Administração",
    items: [
      { href: "/admin/templates", label: "Templates", icon: FileText, roles: ALL },
      { href: "/admin/tenant", label: "Tenant e acesso", icon: KeyRound, roles: ["OWNER"] },
      { href: "/admin/billing", label: "Plano e uso", icon: CreditCard, roles: ANALYTICS },
    ],
  },
  {
    // Internal tools of the SaaS operator: only PLATFORM_ADMIN_EMAILS see them (client companies don't).
    section: "Plataforma (interno)",
    platform: true,
    items: [
      { href: "/admin/pricing", label: "Preços", icon: Tags, roles: ALL },
      { href: "/admin/policies", label: "Políticas", icon: SlidersHorizontal, roles: ALL },
      { href: "/simulator", label: "Simular economia", icon: Calculator, roles: ALL },
      { href: "/research", label: "Experimento A–F", icon: FlaskConical, roles: ALL },
      { href: "/observability", label: "Observabilidade", icon: Activity, roles: ALL },
    ],
  },
];

function ThemeToggle() {
  const [theme, setTheme] = useState<"system" | "light" | "dark">("system");
  useEffect(() => {
    try {
      const t = localStorage.getItem("wco-theme");
      if (t === "light" || t === "dark") setTheme(t);
    } catch {
      /* storage unavailable: follow the system */
    }
  }, []);
  const apply = (t: "system" | "light" | "dark") => {
    setTheme(t);
    try {
      if (t === "system") localStorage.removeItem("wco-theme");
      else localStorage.setItem("wco-theme", t);
    } catch {
      /* ignore */
    }
    if (t === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
  };
  const opts = [
    { v: "light" as const, icon: Sun, label: "Tema claro" },
    { v: "system" as const, icon: Monitor, label: "Tema do sistema" },
    { v: "dark" as const, icon: Moon, label: "Tema escuro" },
  ];
  return (
    <div className="inline-flex rounded-full border border-rule p-0.5" role="radiogroup" aria-label="Tema">
      {opts.map((o) => (
        <button key={o.v} role="radio" aria-checked={theme === o.v} title={o.label} onClick={() => apply(o.v)} className={cx("rounded-full p-1.5", theme === o.v ? "bg-ink text-page" : "text-muted hover:text-ink")}>
          <o.icon className="size-3.5" aria-hidden />
          <span className="sr-only">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function Shell({ me, mode, apiDocsUrl, children }: { me: Me; mode: { mock: boolean; appMode: string } | null; apiDocsUrl: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const role = me.actor.role;
  const logout = async () => {
    await fetch("/auth/session", { method: "DELETE" });
    window.location.href = "/login";
  };
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  const nav = (
    <nav aria-label="Navegação principal" className="space-y-5">
      {NAV.map((s) => {
        if (s.platform && !me.actor.platformAdmin) return null;
        const items = s.items.filter((i) => i.roles.includes(role));
        if (!items.length) return null;
        return (
          <div key={s.section}>
            <p className="px-3 pb-2 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">{s.section}</p>
            <ul className="space-y-0.5">
              {items.map((i) => (
                <li key={i.href}>
                  <Link
                    href={i.href}
                    onClick={() => setOpen(false)}
                    aria-current={isActive(i.href) ? "page" : undefined}
                    className={cx("group flex items-center gap-2.5 rounded-lg px-3 py-[7px] text-[14px]", isActive(i.href) ? "font-semibold text-ink" : "text-ink-2 hover:text-ink")}
                  >
                    <i.icon className={cx("size-4 shrink-0", isActive(i.href) ? "text-ink" : "text-muted group-hover:text-ink")} aria-hidden />
                    {/* "You are here" is a highlighter stroke over the label, not a pill. */}
                    <span className={isActive(i.href) ? "marker" : undefined}>{i.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );

  const canSeeSavings = ANALYTICS.includes(role);
  const side = (
    <div className="flex min-h-full flex-col">
      <Link href="/" className="px-3" onClick={() => setOpen(false)}>
        <Wordmark compact />
      </Link>
      <div className="mt-8 flex-1">{nav}</div>
      {canSeeSavings ? <SavingsMeter /> : null}
    </div>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-[264px] shrink-0 overflow-y-auto border-r border-dashed border-rule px-3 py-6 lg:block">{side}</aside>
      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[280px] overflow-y-auto bg-page px-3 py-6">
            <button onClick={() => setOpen(false)} className="absolute right-3 top-5 rounded-md p-2 text-ink-2" aria-label="Fechar menu">
              <X className="size-4" />
            </button>
            {side}
          </div>
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 bg-page/90 px-4 backdrop-blur sm:px-8">
          <button className="rounded-md p-2 text-ink-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Abrir menu">
            <Menu className="size-4" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-[15px] font-semibold text-ink">{me.tenant.name}</p>
            <p className="truncate text-[11px] text-muted">
              {me.actor.email ?? "API key"} · {role}
            </p>
          </div>
          {mode ? (
            <span
              className={cx("hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium md:inline-flex", mode.mock ? "border-dashed border-rule text-ink-2" : "border-transparent bg-accent text-accent-ink")}
              title={mode.mock ? `MOCK (sem chamadas reais à Meta) · ${mode.appMode}` : `Meta Cloud API · ${mode.appMode}`}
            >
              <span className={cx("size-1.5 rounded-full", mode.mock ? "bg-[var(--warning)]" : "bg-[var(--marker)]")} aria-hidden />
              {mode.mock ? "Modo demonstração · nada é enviado de verdade" : "Conectado à Meta"}
            </span>
          ) : null}
          <a href={apiDocsUrl} target="_blank" rel="noreferrer" className="hidden items-center gap-1 text-xs text-ink-2 hover:text-ink sm:flex" title="Documentação OpenAPI da API">
            <BookOpenCheck className="size-3.5" aria-hidden /> API
          </a>
          <ThemeToggle />
          <button onClick={logout} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-ink-2 hover:bg-surface-2 hover:text-ink">
            <LogOut className="size-3.5" aria-hidden /> Sair
          </button>
        </header>
        <main className="mx-auto w-full max-w-[1320px] flex-1 px-4 pb-16 pt-4 sm:px-8">{children}</main>
      </div>
    </div>
  );
}

/** Counts up to `target` once (skipped when the user prefers reduced motion). */
export function useCountUp(target: number | null, ms = 900): number | null {
  const [v, setV] = useState<number | null>(null);
  useEffect(() => {
    if (target === null) return;
    if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setV(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      setV(target * (1 - Math.pow(1 - t, 3)));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

interface SavingsPeek {
  currency: string;
  isDemoRates: boolean;
  savings: { estimated: { total: string }; realized: { meta: string } };
}

/**
 * "Economímetro": a taximeter running backwards. Always in view, it shows the money not spent in the
 * last 30 days — the estimate (dashed) and what Meta already confirmed (solid) are never added together.
 */
function SavingsMeter() {
  const [query] = useState(() => rangeQuery("30"));
  const { data } = useApi<SavingsPeek>(`savings?${query}`, { refreshMs: 60_000 });
  const total = data ? Number(data.savings.estimated.total) : null;
  const shown = useCountUp(total);
  return (
    <Link href="/#economia" className="mx-1 mt-6 block rounded-2xl border border-dashed border-rule bg-surface p-3.5 hover:border-solid" aria-label="Economímetro: valor que deixou de ser pago nos últimos 30 dias">
      <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Economímetro · 30 dias</p>
      <p className="figure mt-2 text-[22px] font-semibold leading-none text-ink">{shown === null ? "—" : <span className="marker">{money(shown, data?.currency ?? "BRL")}</span>}</p>
      <p className="mt-2 text-[11px] leading-snug text-ink-2">
        deixou de ser pago <span className="text-muted">(estimado{data?.isDemoRates ? ", tarifas demo" : ""})</span>
      </p>
      {data ? (
        <p className="perf-t mt-2.5 flex items-baseline justify-between gap-2 pt-2 text-[11px] text-ink-2">
          <span>confirmado pela Meta</span>
          <span className="figure text-ink">{money(data.savings.realized.meta, data.currency)}</span>
        </p>
      ) : null}
    </Link>
  );
}
