/** Formatting helpers (pt-BR). Money arrives from the API as decimal strings — never floats in storage. */
// Re-exported so the dashboard keeps one import; the product page imports "@/lib/numbers" directly,
// which keeps the labels below out of the code sent to its visitors.
export { int, money } from "./numbers";

export function pct(v: number | string | null | undefined, digits = 1): string {
  if (v === null || v === undefined || v === "") return "—";
  return `${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: digits })}%`;
}

export function dateTime(v: string | Date | null | undefined): string {
  if (!v) return "—";
  return new Date(v).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" });
}

export function day(v: string): string {
  const [y, m, d] = v.split("-");
  return `${d}/${m}${y ? "" : ""}`;
}

export function shortId(id: string | null | undefined): string {
  return id ? id.slice(-8) : "—";
}

/** Human labels for reason codes produced by the engines (codes stay visible for auditability). */
const REASONS: Record<string, string> = {
  same_order: "mesmo pedido",
  superseded_by_newer_state: "substituída por estado mais recente",
  duplicate_event: "evento duplicado",
  within_dedup_window: "dentro da janela de deduplicação",
  consolidated_into_summary: "consolidada em mensagem-resumo",
  authentication_message: "mensagem de autenticação (nunca atrasa)",
  critical_message: "mensagem crítica (nunca atrasa)",
  must_send_immediately: "mustSendImmediately",
  no_optimization_applicable: "nenhuma otimização aplicável",
  free_entry_point_window: "janela gratuita de Free Entry Point",
  customer_service_window: "janela de atendimento (CSW)",
  free_monthly_quota: "cota mensal gratuita",
  scheduled_by_client: "agendada pelo sistema de origem",
  free_form_service_message_cheaper_inside_window: "mensagem livre (service) dentro da janela é mais barata",
};

export function reason(code: string): string {
  return REASONS[code] ?? code.replace(/_/g, " ");
}

export const STATUS_LABEL: Record<string, string> = {
  PENDING_OPTIMIZATION: "Otimizando",
  DELAYED: "No buffer",
  READY_TO_SEND: "Pronta",
  QUEUED: "Na fila",
  SENDING: "Enviando",
  SENT: "Enviada",
  DELIVERED: "Entregue",
  READ: "Lida",
  FAILED: "Falhou",
  DEDUPLICATED: "Deduplicada",
  SUPERSEDED: "Substituída",
  CONSOLIDATED: "Consolidada",
  BLOCKED: "Bloqueada",
  CANCELLED: "Cancelada",
};
