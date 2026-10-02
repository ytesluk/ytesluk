import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { hashPassword, verifyPassword } from "@wco/config";
import { Errors, ROLES, hasPermission, type Permission, type Role } from "@wco/domain";
import { audit } from "./audit";
import type { Actor, AppContext } from "./context";

/**
 * Authentication (spec §45): users (email + scrypt password → JWT) for the dashboard and API keys for
 * system-to-system calls. Permission state is NOT cached (spec §54): role/active are re-read on every
 * request.
 */
export const LoginSchema = z.object({ email: z.string().email(), password: z.string().min(8) });

const secretKey = (ctx: AppContext) => new TextEncoder().encode(ctx.config.jwtSecret);

export function isPlatformAdmin(email: string): boolean {
  return (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

export async function login(ctx: AppContext, raw: unknown) {
  const input = LoginSchema.parse(raw);
  const user = await ctx.db.user.findUnique({ where: { email: input.email.toLowerCase() } });
  // Constant-ish time: always verify a hash.
  const ok = user ? verifyPassword(input.password, user.passwordHash) : verifyPassword(input.password, "scrypt:16384:AAAA:AAAA");
  if (!user || !ok || !user.active) {
    await audit(ctx.db, { tenantId: user?.tenantId ?? null, action: "auth.login_failed", entityType: "User", entityId: user?.id ?? null, data: { email: input.email.replace(/(.).+(@.*)/, "$1***$2") } });
    throw Errors.unauthorized("Invalid credentials");
  }
  const token = await new SignJWT({ tid: user.tenantId, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setIssuer("wco")
    .setExpirationTime(`${ctx.config.env.JWT_TTL_SECONDS}s`)
    .sign(secretKey(ctx));
  await ctx.db.user.update({ where: { id: user.id }, data: { lastLoginAt: ctx.now() } });
  await audit(ctx.db, { tenantId: user.tenantId, actor: { type: "USER", id: user.id, tenantId: user.tenantId, role: user.role }, action: "auth.login", entityType: "User", entityId: user.id });
  const tenant = await ctx.db.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
  return { token, expiresIn: ctx.config.env.JWT_TTL_SECONDS, user: { id: user.id, email: user.email, name: user.name, role: user.role, tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name }, platformAdmin: isPlatformAdmin(user.email) } };
}

export interface AuthenticatedActor extends Actor {
  email?: string;
  platformAdmin: boolean;
}

export async function authenticateBearer(ctx: AppContext, token: string): Promise<AuthenticatedActor> {
  let payload: { sub?: string };
  try {
    ({ payload } = await jwtVerify(token, secretKey(ctx), { issuer: "wco", algorithms: ["HS256"] }));
  } catch {
    throw Errors.unauthorized("Invalid or expired token");
  }
  const user = payload.sub ? await ctx.db.user.findUnique({ where: { id: payload.sub } }) : null;
  if (!user || !user.active) throw Errors.unauthorized("User disabled");
  return { type: "USER", id: user.id, tenantId: user.tenantId, role: user.role, email: user.email, platformAdmin: isPlatformAdmin(user.email) };
}

export const hashApiKey = (key: string) => createHash("sha256").update(key).digest("hex");

export async function authenticateApiKey(ctx: AppContext, key: string): Promise<AuthenticatedActor> {
  const row = await ctx.db.apiKey.findUnique({ where: { keyHash: hashApiKey(key) } });
  if (!row || row.revokedAt) throw Errors.unauthorized("Invalid API key");
  void ctx.db.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: ctx.now() } }).catch(() => undefined);
  return { type: "API_KEY", id: row.id, tenantId: row.tenantId, role: row.role, platformAdmin: false };
}

export function requirePermission(actor: Actor, permission: Permission): void {
  if (!hasPermission(actor.role, permission)) throw Errors.forbidden(`Role ${actor.role} lacks permission ${permission}`);
}

export const CreateApiKeySchema = z.object({ name: z.string().min(1).max(100), role: z.enum(ROLES as [Role, ...Role[]]).default("OPERATOR") });

export async function createApiKey(ctx: AppContext, actor: Actor, raw: unknown) {
  const input = CreateApiKeySchema.parse(raw);
  if (input.role === "OWNER" && actor.role !== "OWNER") throw Errors.forbidden("Only owners can create owner keys");
  const key = `wco_${randomBytes(24).toString("base64url")}`;
  const row = await ctx.db.apiKey.create({ data: { tenantId: actor.tenantId, name: input.name, prefix: key.slice(0, 10), keyHash: hashApiKey(key), role: input.role } });
  await audit(ctx.db, { tenantId: actor.tenantId, actor, action: "apikey.created", entityType: "ApiKey", entityId: row.id, data: { name: input.name, role: input.role } });
  return { id: row.id, name: row.name, role: row.role, prefix: row.prefix, key, note: "Store this key now; it is never shown again." };
}

export async function revokeApiKey(ctx: AppContext, actor: Actor, id: string) {
  const row = await ctx.db.apiKey.findFirst({ where: { id, tenantId: actor.tenantId } });
  if (!row) throw Errors.notFound("API key");
  await ctx.db.apiKey.update({ where: { id }, data: { revokedAt: ctx.now() } });
  await audit(ctx.db, { tenantId: actor.tenantId, actor, action: "apikey.revoked", entityType: "ApiKey", entityId: id });
  return { revoked: true };
}

export async function listApiKeys(ctx: AppContext, tenantId: string) {
  return ctx.db.apiKey.findMany({ where: { tenantId }, select: { id: true, name: true, prefix: true, role: true, lastUsedAt: true, revokedAt: true, createdAt: true }, orderBy: { createdAt: "desc" } });
}

export const CreateUserSchema = z.object({ email: z.string().email(), name: z.string().min(1), password: z.string().min(10), role: z.enum(ROLES as [Role, ...Role[]]) });

export async function createUser(ctx: AppContext, actor: Actor, raw: unknown) {
  const input = CreateUserSchema.parse(raw);
  try {
    const user = await ctx.db.user.create({ data: { tenantId: actor.tenantId, email: input.email.toLowerCase(), name: input.name, passwordHash: hashPassword(input.password), role: input.role } });
    await audit(ctx.db, { tenantId: actor.tenantId, actor, action: "user.created", entityType: "User", entityId: user.id, data: { role: input.role } });
    return { id: user.id, email: user.email, name: user.name, role: user.role };
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw Errors.conflict("Email already in use");
    throw e;
  }
}

export async function listUsers(ctx: AppContext, tenantId: string) {
  return ctx.db.user.findMany({ where: { tenantId }, select: { id: true, email: true, name: true, role: true, active: true, lastLoginAt: true, createdAt: true }, orderBy: { createdAt: "asc" } });
}
