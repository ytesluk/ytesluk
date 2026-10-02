import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Permission } from "@wco/domain";
import { metricsContentType, metricsText } from "@wco/logging";
import {
  CreateApiKeySchema,
  CreateIntentSchema,
  CreateUserSchema,
  ListIntentsQuery,
  LoginSchema,
  createApiKey,
  createIntent,
  createUser,
  getIntentAudit,
  ingestWebhook,
  listApiKeys,
  listIntents,
  listUsers,
  login,
  revokeApiKey,
  type AppContext,
} from "@wco/services";
import { verifyChallenge } from "@wco/whatsapp";
import { actorOf, authenticate, doc, guard } from "../http";

export async function coreRoutes(app: FastifyInstance, ctx: AppContext) {
  // ---------------------------------------------------------------- system
  app.get("/api/v1/health", { schema: { tags: ["system"], summary: "Liveness/readiness (DB + Redis)" } }, async (_req, reply) => {
    const checks: Record<string, string> = {};
    try {
      await ctx.db.$queryRaw`SELECT 1`;
      checks.database = "ok";
    } catch {
      checks.database = "down";
    }
    checks.redis = ctx.redis.status === "ready" ? "ok" : ctx.redis.status;
    const ok = Object.values(checks).every((v) => v === "ok");
    return reply.status(ok ? 200 : 503).send({ status: ok ? "ok" : "degraded", checks, mode: ctx.config.mode, mockWhatsApp: ctx.config.meta.mock, graphApiVersion: ctx.config.meta.graphApiVersion ?? null, time: new Date().toISOString() });
  });

  app.get("/api/v1/metrics", { schema: { tags: ["system"], summary: "Prometheus metrics" } }, async (req, reply) => {
    const token = process.env.METRICS_TOKEN;
    if (token && req.headers.authorization !== `Bearer ${token}`) return reply.status(401).send({ error: { code: "UNAUTHORIZED", message: "metrics token required" } });
    return reply.header("Content-Type", metricsContentType()).send(await metricsText());
  });

  // ---------------------------------------------------------------- auth
  app.post("/api/v1/auth/login", { schema: { tags: ["auth"], body: doc(LoginSchema) }, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => login(ctx, req.body));
  app.get("/api/v1/auth/me", { schema: { tags: ["auth"] } }, async (req) => {
    const a = await authenticate(ctx, req);
    const tenant = await ctx.db.tenant.findUniqueOrThrow({ where: { id: a.tenantId } });
    return { actor: { type: a.type, id: a.id, role: a.role, email: a.email, platformAdmin: a.platformAdmin }, tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name } };
  });
  app.get("/api/v1/api-keys", { schema: { tags: ["auth"] }, preHandler: guard(ctx, Permission.TENANT_MANAGE) }, async (req) => listApiKeys(ctx, actorOf(req).tenantId));
  app.post("/api/v1/api-keys", { schema: { tags: ["auth"], body: doc(CreateApiKeySchema) }, preHandler: guard(ctx, Permission.TENANT_MANAGE) }, async (req, reply) => reply.status(201).send(await createApiKey(ctx, actorOf(req), req.body)));
  app.delete("/api/v1/api-keys/:id", { schema: { tags: ["auth"] }, preHandler: guard(ctx, Permission.TENANT_MANAGE) }, async (req) => revokeApiKey(ctx, actorOf(req), (req.params as { id: string }).id));
  app.get("/api/v1/users", { schema: { tags: ["auth"] }, preHandler: guard(ctx, Permission.USERS_MANAGE) }, async (req) => listUsers(ctx, actorOf(req).tenantId));
  app.post("/api/v1/users", { schema: { tags: ["auth"], body: doc(CreateUserSchema) }, preHandler: guard(ctx, Permission.USERS_MANAGE) }, async (req, reply) => reply.status(201).send(await createUser(ctx, actorOf(req), req.body)));

  // ---------------------------------------------------------------- messages (spec §30, §31)
  app.post(
    "/api/v1/messages/intents",
    { schema: { tags: ["messages"], summary: "Create a message intent (202 Accepted; optimization is asynchronous)", body: doc(CreateIntentSchema) }, preHandler: guard(ctx, Permission.MESSAGES_WRITE) },
    async (req, reply) => {
      const r = await createIntent(ctx, actorOf(req), req.body, { requestId: req.id });
      return reply.status(r.idempotent ? 200 : 202).send(r);
    },
  );
  app.post(
    "/api/v1/messages/send",
    { schema: { tags: ["messages"], summary: "Send now: intent with mustSendImmediately=true (never buffered)", body: doc(CreateIntentSchema) }, preHandler: guard(ctx, Permission.MESSAGES_WRITE) },
    async (req, reply) => {
      const r = await createIntent(ctx, actorOf(req), { ...(req.body as object), mustSendImmediately: true }, { requestId: req.id });
      return reply.status(r.idempotent ? 200 : 202).send(r);
    },
  );
  app.get("/api/v1/messages", { schema: { tags: ["messages"], querystring: doc(ListIntentsQuery) }, preHandler: guard(ctx, Permission.MESSAGES_READ) }, async (req) => listIntents(ctx, actorOf(req).tenantId, ListIntentsQuery.parse(req.query)));
  app.get("/api/v1/messages/:id", { schema: { tags: ["messages"], summary: "Message audit: events, decisions, policy, pricing, delivery, savings" }, preHandler: guard(ctx, Permission.MESSAGES_READ) }, async (req) =>
    getIntentAudit(ctx, actorOf(req).tenantId, z.string().uuid().parse((req.params as { id: string }).id)),
  );

  // ---------------------------------------------------------------- Meta webhooks (spec §25)
  app.get("/api/v1/webhooks/meta", { schema: { tags: ["webhooks"], summary: "Meta verification challenge" } }, async (req, reply) => {
    const r = verifyChallenge(req.query as Record<string, unknown>, ctx.config.meta.webhookVerifyToken);
    if (!r.ok) return reply.status(403).send({ error: { code: "FORBIDDEN", message: "verification failed" } });
    return reply.type("text/plain").send(r.challenge);
  });
  app.post("/api/v1/webhooks/meta", { schema: { tags: ["webhooks"], summary: "Meta webhook receiver: validate → persist raw → ACK → queue" }, config: { rateLimit: false } }, async (req, reply) => {
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    const header = req.headers["x-hub-signature-256"];
    const r = await ingestWebhook(ctx, { rawBody: raw, signature: typeof header === "string" ? header : undefined });
    if (r.status !== 200) return reply.status(r.status).send({ error: { code: r.status === 401 ? "INVALID_SIGNATURE" : "INVALID_PAYLOAD", message: "rejected" } });
    return reply.status(200).send({ received: true, duplicate: !!r.duplicate });
  });
}
