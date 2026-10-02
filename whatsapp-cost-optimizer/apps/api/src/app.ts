import { randomUUID, createHash } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { metrics, PINO_REDACT_PATHS } from "@wco/logging";
import type { AppContext } from "@wco/services";
import { errorHandler } from "./http";
import { adminRoutes } from "./routes/admin";
import { coreRoutes } from "./routes/core";
import { insightRoutes } from "./routes/insights";

export async function buildApp(ctx: AppContext, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger === false ? false : { level: ctx.config.env.LOG_LEVEL, redact: { paths: [...PINO_REDACT_PATHS, "req.headers['x-hub-signature-256']"], censor: "[REDACTED]" } },
    genReqId: (req) => (typeof req.headers["x-request-id"] === "string" && req.headers["x-request-id"].length < 100 ? req.headers["x-request-id"] : randomUUID()),
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: true,
  });

  // Validation is done by zod in handlers; JSON Schemas are used only to document the API (OpenAPI).
  app.setValidatorCompiler(() => () => true);

  // Keep the raw body: Meta signs the exact bytes (X-Hub-Signature-256).
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (req, body, done) => {
    const buf = body as Buffer;
    req.rawBody = buf;
    if (buf.length === 0) return done(null, {});
    try {
      done(null, JSON.parse(buf.toString("utf8")));
    } catch (e) {
      (e as { statusCode?: number }).statusCode = 400;
      done(e as Error, undefined);
    }
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: (ctx.config.env.CORS_ORIGINS ?? ctx.config.env.NEXT_PUBLIC_APP_URL).split(",").map((s) => s.trim()), credentials: true });
  // Tenant/API rate limit (spec §55): keyed by credential (hashed) or client IP, stored in Redis.
  await app.register(rateLimit, {
    global: true,
    max: ctx.config.env.RATE_LIMIT_PER_MINUTE,
    timeWindow: "1 minute",
    redis: ctx.redis,
    nameSpace: "wco-rl:",
    keyGenerator: (req) => {
      const cred = (req.headers["x-api-key"] as string | undefined) ?? req.headers.authorization;
      return cred ? createHash("sha256").update(cred).digest("hex").slice(0, 32) : req.ip;
    },
  });
  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "WhatsApp Cost Optimizer API",
        version: "0.1.0",
        description:
          "WCO REST API. All money values are decimal strings. Costs/savings are labelled ESTIMATED or REALIZED; DEMO rate cards contain fictitious values. Authentication: `Authorization: Bearer <JWT>` (dashboard users) or `X-API-Key` (systems).",
      },
      components: {
        securitySchemes: {
          bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
          apiKey: { type: "apiKey", in: "header", name: "X-API-Key" },
        },
      },
      security: [{ bearer: [] }, { apiKey: [] }],
    },
  });
  await app.register(swaggerUi, { routePrefix: "/api/docs" });

  app.addHook("onRequest", async (req, reply) => {
    void reply.header("x-request-id", req.id);
  });
  app.addHook("onResponse", async (req, reply) => {
    metrics.httpLatency.observe({ method: req.method, route: req.routeOptions.url ?? "unknown", status: String(reply.statusCode) }, reply.elapsedTime / 1000);
  });
  app.setErrorHandler(errorHandler);

  await coreRoutes(app, ctx);
  await insightRoutes(app, ctx);
  await adminRoutes(app, ctx);
  app.get("/api/openapi.json", { schema: { hide: true } }, async () => app.swagger());
  return app;
}
