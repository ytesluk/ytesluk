import type { FastifyReply, FastifyRequest } from "fastify";
import { z, ZodError } from "zod";
import { AppError, Errors, isAppError, type Permission } from "@wco/domain";
import { authenticateApiKey, authenticateBearer, requirePermission, type AppContext, type AuthenticatedActor } from "@wco/services";

declare module "fastify" {
  interface FastifyRequest {
    actor?: AuthenticatedActor;
    rawBody?: Buffer;
  }
}

/** Resolves the caller from `Authorization: Bearer <jwt>` or `X-API-Key`. */
export async function authenticate(ctx: AppContext, req: FastifyRequest): Promise<AuthenticatedActor> {
  if (req.actor) return req.actor;
  const apiKey = req.headers["x-api-key"];
  const auth = req.headers.authorization;
  let actor: AuthenticatedActor;
  if (typeof apiKey === "string" && apiKey.length > 0) actor = await authenticateApiKey(ctx, apiKey);
  else if (auth?.startsWith("Bearer ")) actor = await authenticateBearer(ctx, auth.slice(7));
  else throw Errors.unauthorized("Missing credentials (Authorization: Bearer <token> or X-API-Key)");
  req.actor = actor;
  return actor;
}

export function guard(ctx: AppContext, permission: Permission) {
  return async (req: FastifyRequest) => {
    const actor = await authenticate(ctx, req);
    requirePermission(actor, permission);
  };
}

export function actorOf(req: FastifyRequest): AuthenticatedActor {
  if (!req.actor) throw Errors.unauthorized();
  return req.actor;
}

/** zod → JSON Schema for OpenAPI documentation (validation itself is done by zod in handlers). */
export function doc(schema: z.ZodType): Record<string, unknown> {
  try {
    const js = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
    delete js.$schema;
    return js;
  } catch {
    return { type: "object" };
  }
}

/** Uniform error body (spec §56): code, message, retryable, provider, providerCode, requestId, timestamp. */
export function errorHandler(err: unknown, req: FastifyRequest, reply: FastifyReply) {
  let e: AppError;
  if (isAppError(err)) e = err;
  else if (err instanceof ZodError) e = Errors.validation("Invalid request", { issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  else if ((err as { statusCode?: number }).statusCode === 429) e = new AppError({ code: "RATE_LIMITED", message: "Too many requests", httpStatus: 429, retryable: true });
  else if ((err as { statusCode?: number }).statusCode && (err as { statusCode: number }).statusCode < 500) {
    e = new AppError({ code: (err as { code?: string }).code ?? "BAD_REQUEST", message: (err as Error).message, httpStatus: (err as { statusCode: number }).statusCode });
  } else if ((err as { code?: string }).code === "P2025") e = Errors.notFound("Resource");
  else {
    req.log.error({ err }, "unhandled error");
    e = new AppError({ code: "INTERNAL_ERROR", message: "Internal error", httpStatus: 500, retryable: true });
  }
  e.requestId = req.id;
  void reply.status(e.httpStatus).send({ error: e.toJSON() });
}
