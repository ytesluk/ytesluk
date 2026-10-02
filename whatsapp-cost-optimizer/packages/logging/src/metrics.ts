import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

/**
 * Prometheus metrics (spec §47, §48). Counters are cheap and in-process; dashboards aggregate across
 * replicas. Labels are low-cardinality only (tenant id is acceptable up to ~1k tenants; never phones).
 */
export const registry = new Registry();

let defaultsCollected = false;
export function enableDefaultMetrics(service: string): void {
  if (defaultsCollected) return;
  registry.setDefaultLabels({ service });
  collectDefaultMetrics({ register: registry });
  defaultsCollected = true;
}

const tenant = ["tenant_id"] as const;

export const metrics = {
  intentsReceived: new Counter({
    name: "wco_intents_received_total",
    help: "Message intents received",
    labelNames: [...tenant, "event_type"],
    registers: [registry],
  }),
  decisions: new Counter({
    name: "wco_optimization_decisions_total",
    help: "Optimization decisions by action",
    labelNames: [...tenant, "action"],
    registers: [registry],
  }),
  messagesAvoided: new Counter({
    name: "wco_messages_avoided_total",
    help: "Messages avoided (deduplicated, superseded, consolidated)",
    labelNames: [...tenant, "reason"],
    registers: [registry],
  }),
  messagesSent: new Counter({
    name: "wco_messages_sent_total",
    help: "Messages accepted by the provider",
    labelNames: [...tenant, "category"],
    registers: [registry],
  }),
  messagesDelivered: new Counter({
    name: "wco_messages_delivered_total",
    help: "Messages delivered (status webhook)",
    labelNames: [...tenant, "category"],
    registers: [registry],
  }),
  estimatedCost: new Counter({
    name: "wco_estimated_cost_total",
    help: "Estimated Meta cost (currency units, informational)",
    labelNames: [...tenant, "currency"],
    registers: [registry],
  }),
  realizedCost: new Counter({
    name: "wco_realized_cost_total",
    help: "Realized Meta cost from delivery webhooks (currency units, informational)",
    labelNames: [...tenant, "currency"],
    registers: [registry],
  }),
  estimatedSavings: new Counter({
    name: "wco_estimated_savings_total",
    help: "Estimated Meta savings (currency units)",
    labelNames: [...tenant, "currency"],
    registers: [registry],
  }),
  freeEntryPointUsage: new Counter({
    name: "wco_free_entry_point_messages_total",
    help: "Messages priced as free because of an open free entry point window",
    labelNames: tenant,
    registers: [registry],
  }),
  freeQuotaUsage: new Counter({
    name: "wco_free_quota_messages_total",
    help: "Messages priced against a free quota",
    labelNames: tenant,
    registers: [registry],
  }),
  tierDistribution: new Counter({
    name: "wco_tier_messages_total",
    help: "Charged messages by volume tier",
    labelNames: ["market", "category", "tier"],
    registers: [registry],
  }),
  metaApiRequests: new Counter({
    name: "wco_meta_api_requests_total",
    help: "Provider API requests",
    labelNames: ["provider", "operation", "outcome"],
    registers: [registry],
  }),
  metaApiLatency: new Histogram({
    name: "wco_meta_api_latency_seconds",
    help: "Provider API latency",
    labelNames: ["provider", "operation"],
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
    registers: [registry],
  }),
  costCalculationErrors: new Counter({
    name: "wco_cost_calculation_errors_total",
    help: "Pricing evaluations that ended as UNKNOWN or failed",
    labelNames: ["reason"],
    registers: [registry],
  }),
  webhooksReceived: new Counter({
    name: "wco_webhooks_received_total",
    help: "Webhook deliveries received",
    labelNames: ["outcome"],
    registers: [registry],
  }),
  queueDepth: new Gauge({
    name: "wco_queue_depth",
    help: "Jobs waiting/delayed/active/failed per queue",
    labelNames: ["queue", "state"],
    registers: [registry],
  }),
  circuitState: new Gauge({
    name: "wco_circuit_breaker_open",
    help: "1 when the provider circuit breaker is open",
    labelNames: ["provider"],
    registers: [registry],
  }),
  httpLatency: new Histogram({
    name: "wco_http_request_duration_seconds",
    help: "API request latency",
    labelNames: ["method", "route", "status"],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.3, 1, 3],
    registers: [registry],
  }),
};

export async function metricsText(): Promise<string> {
  return registry.metrics();
}

export function metricsContentType(): string {
  return registry.contentType;
}
