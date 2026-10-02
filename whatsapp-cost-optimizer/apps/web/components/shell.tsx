"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Activity,
  Bell,
  BookOpenCheck,
  Calculator,
  ChartColumn,
  FileText,
  FlaskConical,
  Gauge,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  MessagesSquare,
  Monitor,
  Moon,
  Plug,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Tags,
  Webhook,
  X,
} from "lucide-react";
import type { Me } from "@/lib/server";
import { cx } from "./ui";

type Role = Me["actor"]["role"];
const ALL: Role[] = ["OWNER", "ADMIN", "ANALYST", "OPERATOR"];
const CONFIG: Role[] = ["OWNER", "ADMIN"];
const ANALYTICS: Role[] = ["OWNER", "ADMIN", "ANALYST"];

/** Navigation mirrors the API's RBAC (the API re-checks every request; hiding is only UX). */
const NAV: Array<{ section: string; items: Array<{ href: string; label: string; icon: React.ComponentType<{ className?: string }>; roles: Role[] }> }> = [
  {
    section: "Operação",
    items: [
      { href: "/", label: "Visão geral", icon: LayoutDashboard, roles: ANALYTICS },
      { href: "/optimization", label: "Otimização", icon: ChartColumn, roles: ANALYTICS },
      { href: "/messages", label: "Mensagens", icon: MessageSquare, roles: ALL },
      { href: "/conversations", label: "Conversas e janelas", icon: MessagesSquare, roles: ALL },
      { href: "/alerts", label: "Alertas", icon: Bell, roles: ANALYTICS },
      { href: "/observability", label: "Observabilidade", icon: Activity, roles: ["OWNER", "ADMIN", "OPERATOR"] },
    ],
  },
  {
    section: "Análise",
    items: [
      { href: "/simulator", label: "Simular economia", icon: Calculator, roles: ANALYTICS },
      { href: "/research", label: "Experimento A–F", icon: FlaskConical, roles: ANALYTICS },
    ],
  },
  {
    section: "Administração",
    items: [
      { href: "/admin/pricing", label: "Preços", icon: Tags, roles: ANALYTICS },
      { href: "/admin/policies", label: "Políticas", icon: SlidersHorizontal, roles: ANALYTICS },
      { href: "/admin/templates", label: "Templates", icon: FileText, roles: ALL },
      { href: "/admin/providers", label: "Conectar WhatsApp", icon: Plug, roles: CONFIG },
      { href: "/admin/webhooks", label: "Webhooks", icon: Webhook, roles: ["OWNER", "ADMIN", "OPERATOR"] },
      { href: "/admin/tenant", label: "Tenant e acesso", icon: KeyRound, roles: ["OWNER"] },
      { href: "/admin/privacy", label: "Privacidade (LGPD)", icon: ShieldCheck, roles: CONFIG },
      { href: "/admin/audit", label: "Auditoria", icon: ScrollText, roles: CONFIG },
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
    <div className="inline-flex rounded-lg border border-line p-0.5" role="radiogroup" aria-label="Tema">
      {opts.map((o) => (
        <button key={o.v} role="radio" aria-checked={theme === o.v} title={o.label} onClick={() => apply(o.v)} className={cx("rounded-md p-1.5", theme === o.v ? "bg-surface-2 text-ink" : "text-muted hover:text-ink")}>
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
        const items = s.items.filter((i) => i.roles.includes(role));
        if (!items.length) return null;
        return (
          <div key={s.section}>
            <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{s.section}</p>
            <ul className="space-y-0.5">
              {items.map((i) => (
                <li key={i.href}>
                  <Link
                    href={i.href}
                    onClick={() => setOpen(false)}
                    aria-current={isActive(i.href) ? "page" : undefined}
                    className={cx("flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm", isActive(i.href) ? "bg-surface-2 font-medium text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink")}
                  >
                    <i.icon className="size-4 shrink-0" aria-hidden />
                    {i.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 overflow-y-auto border-r border-line bg-surface px-3 py-5 lg:block">
        <Brand />
        <div className="mt-6">{nav}</div>
      </aside>
      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 overflow-y-auto bg-surface px-3 py-5">
            <div className="flex items-center justify-between">
              <Brand />
              <button onClick={() => setOpen(false)} className="rounded-md p-2 text-ink-2" aria-label="Fechar menu">
                <X className="size-4" />
              </button>
            </div>
            <div className="mt-6">{nav}</div>
          </div>
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur sm:px-6">
          <button className="rounded-md p-2 text-ink-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Abrir menu">
            <Menu className="size-4" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink">{me.tenant.name}</p>
            <p className="truncate text-[11px] text-muted">
              {me.actor.email ?? "API key"} · {role}
              {mode ? ` · ${mode.mock ? "MOCK (sem chamadas reais à Meta)" : "Meta Cloud API"} · ${mode.appMode}` : ""}
            </p>
          </div>
          <a href={apiDocsUrl} target="_blank" rel="noreferrer" className="hidden items-center gap-1 text-xs text-ink-2 hover:text-ink sm:flex" title="Documentação OpenAPI da API">
            <BookOpenCheck className="size-3.5" aria-hidden /> API
          </a>
          <ThemeToggle />
          <button onClick={logout} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-ink-2 hover:bg-surface-2 hover:text-ink">
            <LogOut className="size-3.5" aria-hidden /> Sair
          </button>
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2 px-3">
      <span className="grid size-7 place-items-center rounded-lg bg-accent text-white">
        <Gauge className="size-4" aria-hidden />
      </span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold text-ink">WCO</span>
        <span className="block text-[11px] text-muted">WhatsApp Cost Optimizer</span>
      </span>
    </Link>
  );
}
