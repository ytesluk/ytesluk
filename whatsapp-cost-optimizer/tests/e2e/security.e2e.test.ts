import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrateTestDatabase, truncateAll, useTestEnv } from "@wco/testing";
import { createAppContext, seedAll, type AppContext } from "@wco/services";
import { buildApp } from "../../apps/api/src/app";

/**
 * Security regressions over the real HTTP API: each test is an attack that used to work.
 *  - a company (self sign-up) changing the platform's shared rate cards or running platform tools;
 *  - claiming a platform operator's e-mail through sign-up;
 *  - dodging the login limit with a made-up Authorization header;
 *  - guessing one account's password from many places (per-account lock).
 */
const PORT = 4598;
const BASE = `http://127.0.0.1:${PORT}`;
const PLATFORM_ADMIN = "admin@loja-demo.wco.dev";
let ctx: AppContext;
let app: FastifyInstance;
let password: string;

async function call(method: string, path: string, opts: { body?: unknown; token?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- assertions navigate arbitrary JSON
  return { status: res.status, body: (text ? JSON.parse(text) : null) as any };
}

async function token(email: string) {
  const r = await call("POST", "/api/v1/auth/login", { body: { email, password } });
  expect(r.status).toBe(200);
  return r.body.token as string;
}

beforeAll(async () => {
  useTestEnv({ API_PORT: String(PORT), API_INTERNAL_URL: BASE, API_PUBLIC_URL: BASE, PLATFORM_ADMIN_EMAILS: PLATFORM_ADMIN });
  process.env.PLATFORM_ADMIN_EMAILS = PLATFORM_ADMIN;
  migrateTestDatabase();
  ctx = createAppContext({ service: "e2e-security" });
  await truncateAll(ctx.db);
  await ctx.redis.flushdb();
  password = (await seedAll(ctx, { demoHistory: false })).password!;
  app = await buildApp(ctx, { logger: false });
  await app.listen({ port: PORT, host: "127.0.0.1" });
});

afterAll(async () => {
  await app?.close();
  await ctx?.close();
});

describe("platform tools are for WCO operators only", () => {
  it("a company owner cannot touch the shared rate cards nor run the simulators", async () => {
    const owner = await token("owner@acme.wco.dev");
    const calls: Array<[string, string, unknown]> = [
      ["POST", "/api/v1/pricing/import", { format: "json", content: "{}" }],
      ["PATCH", `/api/v1/pricing/rate-cards/${randomUUID()}`, { status: "RETIRED" }],
      ["POST", "/api/v1/simulate/savings", {}],
      ["POST", "/api/v1/simulate/rate-card", {}],
      ["POST", "/api/v1/simulate/bsp", {}],
      ["POST", "/api/v1/import/history", {}],
      ["POST", "/api/v1/research/run", {}],
      ["GET", "/api/v1/research/runs", undefined],
    ];
    for (const [method, path, body] of calls) {
      const r = await call(method, path, { token: owner, body });
      expect(r.status, `${method} ${path}`).toBe(403);
    }
    // Reading the prices stays open to the company (its costs are computed with them).
    expect((await call("GET", "/api/v1/pricing", { token: owner })).status).toBe(200);
  });

  it("the platform operator still can", async () => {
    const admin = await token(PLATFORM_ADMIN);
    const r = await call("GET", "/api/v1/research/runs", { token: admin });
    expect(r.status).toBe(200);
  });

  it("nobody can sign up with a platform operator's e-mail", async () => {
    await ctx.db.user.deleteMany({ where: { email: PLATFORM_ADMIN } }); // as if the operator had not registered yet
    const r = await call("POST", "/api/v1/auth/signup", { body: { companyName: "Invasor", name: "X", email: PLATFORM_ADMIN.toUpperCase(), password: "senha-forte-123", acceptTerms: true } });
    expect(r.status).toBe(403);
    expect(await ctx.db.user.count({ where: { email: PLATFORM_ADMIN } })).toBe(0);
  });
});

describe("login brute force", () => {
  it("locks an e-mail after 10 wrong passwords, even when the right one comes next", async () => {
    await ctx.redis.flushdb();
    for (let i = 0; i < 10; i++) {
      expect((await call("POST", "/api/v1/auth/login", { body: { email: "analyst@acme.wco.dev", password: `errada-${i}` } })).status).toBe(401);
    }
    const r = await call("POST", "/api/v1/auth/login", { body: { email: "analyst@acme.wco.dev", password } });
    expect(r.status).toBe(429);
    // Other accounts are not affected.
    expect((await call("POST", "/api/v1/auth/login", { body: { email: "operator@acme.wco.dev", password } })).status).toBe(200);
  });

  it("a made-up Authorization header does not give a fresh login allowance", async () => {
    await ctx.redis.flushdb();
    const statuses: number[] = [];
    for (let i = 0; i < 22; i++) {
      const r = await call("POST", "/api/v1/auth/login", { headers: { authorization: `Bearer ${randomUUID()}` }, body: { email: `ninguem-${i}@example.test`, password: "qualquer-coisa" } });
      statuses.push(r.status);
    }
    expect(statuses).toContain(429);
  });
});
