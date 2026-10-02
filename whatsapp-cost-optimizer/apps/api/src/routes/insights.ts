import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Errors, Permission } from "@wco/domain";
import {
  RangeQuery,
  acknowledgeAlert,
  cost,
  daily,
  getConversation,
  insights,
  listAlerts,
  listAudit,
  listConversations,
  listWebhookEvents,
  operations,
  optimizationBreakdown,
  platformTenants,
  summary,
  type AppContext,
} from "@wco/services";
import { actorOf, authenticate, doc, guard } from "../http";

export async function insightRoutes(app: FastifyInstance, ctx: AppContext) {
  const q = (req: { query: unknown }) => RangeQuery.parse(req.query);
  const t = (req: Parameters<typeof actorOf>[0]) => actorOf(req).tenantId;

  app.get("/api/v1/conversations", { schema: { tags: ["conversations"] }, preHandler: guard(ctx, Permission.CONVERSATIONS_READ) }, async (req) =>
    listConversations(ctx, t(req), { limit: Number((req.query as { limit?: string }).limit ?? 50) }),
  );
  app.get("/api/v1/conversations/:id", { schema: { tags: ["conversations"] }, preHandler: guard(ctx, Permission.CONVERSATIONS_READ) }, async (req) =>
    getConversation(ctx, t(req), z.string().uuid().parse((req.params as { id: string }).id)),
  );

  app.get("/api/v1/cost/estimate", { schema: { tags: ["cost"], querystring: doc(RangeQuery) }, preHandler: guard(ctx, Permission.COST_READ) }, async (req) => cost(ctx, t(req), q(req), "estimate"));
  app.get("/api/v1/cost/actual", { schema: { tags: ["cost"], querystring: doc(RangeQuery) }, preHandler: guard(ctx, Permission.COST_READ) }, async (req) => cost(ctx, t(req), q(req), "actual"));

  app.get("/api/v1/savings", { schema: { tags: ["savings"], summary: "Estimated vs realized savings; META, BSP and infrastructure separated", querystring: doc(RangeQuery) }, preHandler: guard(ctx, Permission.ANALYTICS_READ) }, async (req) => {
    const s = await summary(ctx, t(req), q(req));
    return { currency: s.currency, isDemoRates: s.isDemoRates, range: s.range, savings: s.savings, costs: s.costs, daily: await daily(ctx, t(req), q(req)) };
  });

  app.get("/api/v1/analytics", { schema: { tags: ["analytics"], querystring: doc(RangeQuery) }, preHandler: guard(ctx, Permission.ANALYTICS_READ) }, async (req) => {
    const [s, d, b, i] = await Promise.all([summary(ctx, t(req), q(req)), daily(ctx, t(req), q(req)), optimizationBreakdown(ctx, t(req), q(req)), insights(ctx, t(req), q(req))]);
    return { summary: s, daily: d, breakdown: b, insights: i };
  });

  app.get("/api/v1/observability", { schema: { tags: ["system"], summary: "Queue depth, throughput, error rate, Meta API latency" }, preHandler: guard(ctx, Permission.OBSERVABILITY_READ) }, async (req) => operations(ctx, t(req)));

  app.get("/api/v1/alerts", { schema: { tags: ["alerts"] }, preHandler: guard(ctx, Permission.ANALYTICS_READ) }, async (req) => listAlerts(ctx, t(req)));
  app.post("/api/v1/alerts/:id/ack", { schema: { tags: ["alerts"] }, preHandler: guard(ctx, Permission.POLICIES_WRITE) }, async (req) => acknowledgeAlert(ctx, actorOf(req), (req.params as { id: string }).id));

  app.get("/api/v1/audit", { schema: { tags: ["audit"] }, preHandler: guard(ctx, Permission.AUDIT_READ) }, async (req) => {
    const qq = req.query as { entityType?: string; entityId?: string; limit?: string };
    return listAudit(ctx, t(req), { entityType: qq.entityType, entityId: qq.entityId, limit: qq.limit ? Number(qq.limit) : undefined });
  });
  app.get("/api/v1/webhooks/events", { schema: { tags: ["webhooks"] }, preHandler: guard(ctx, Permission.WEBHOOKS_READ) }, async (req) => {
    const qq = req.query as { status?: string; limit?: string };
    return listWebhookEvents(ctx, t(req), { status: qq.status, limit: qq.limit ? Number(qq.limit) : undefined });
  });

  app.get("/api/v1/admin/platform/tenants", { schema: { tags: ["admin"], summary: "Platform view (PLATFORM_ADMIN_EMAILS only)" } }, async (req) => {
    const a = await authenticate(ctx, req);
    if (!a.platformAdmin) throw Errors.forbidden("Platform administrators only");
    return platformTenants(ctx);
  });
}
