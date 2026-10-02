import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, apiBase } from "@/lib/server";
import { sameOrigin } from "@/lib/origin";

/**
 * Backend-for-frontend proxy: /bff/<path> → API /api/v1/<path>, adding the session's bearer token.
 * Only the WCO API is reachable (no open proxy); Meta is never called from the browser or the BFF.
 */
async function forward(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  if (!sameOrigin(req)) return NextResponse.json({ error: { code: "FORBIDDEN", message: "Origem inválida" } }, { status: 403 });
  const { path } = await ctx.params;
  if (path.some((p) => p === ".." || p.includes("/"))) return NextResponse.json({ error: { code: "BAD_PATH" } }, { status: 400 });
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Sessão expirada" } }, { status: 401 });
  const url = `${apiBase()}/api/v1/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;
  const method = req.method.toUpperCase();
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  const reqId = req.headers.get("x-request-id");
  if (reqId) headers["x-request-id"] = reqId;
  let body: string | undefined;
  if (method !== "GET" && method !== "HEAD") {
    body = await req.text();
    if (body) headers["content-type"] = req.headers.get("content-type") ?? "application/json";
  }
  const res = await fetch(url, { method, headers, body, cache: "no-store" });
  const out = new NextResponse(res.status === 204 ? null : await res.arrayBuffer(), { status: res.status });
  const ct = res.headers.get("content-type");
  if (ct) out.headers.set("content-type", ct);
  const rid = res.headers.get("x-request-id");
  if (rid) out.headers.set("x-request-id", rid);
  if (res.status === 401) out.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return out;
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
