import { cookies } from "next/headers";
import { NextResponse } from "next/server";

/** Server-side helpers for the BFF. The JWT never reaches browser JavaScript. */
export const SESSION_COOKIE = "wco_session";
export const apiBase = () => (process.env.API_INTERNAL_URL ?? "http://localhost:4000").replace(/\/$/, "");

export async function sessionToken(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

export interface Me {
  actor: { type: string; id: string | null; role: "OWNER" | "ADMIN" | "ANALYST" | "OPERATOR"; email?: string | null; platformAdmin?: boolean };
  tenant: { id: string; slug: string; name: string };
}

/** Calls the API with the session's bearer token. Returns null on 401 (expired/invalid session). */
export async function serverApi<T>(path: string, init: RequestInit = {}): Promise<T | null> {
  const token = await sessionToken();
  if (!token) return null;
  const res = await fetch(`${apiBase()}/api/v1/${path.replace(/^\//, "")}`, {
    ...init,
    headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`API ${res.status} em ${path}`);
  return (await res.json()) as T;
}

/**
 * The visitor's address chain, passed on to the API (which trusts it only from the private network)
 * so its per-IP limits apply per visitor instead of to the dashboard server as a whole.
 */
export function forwardedFor(from?: { get(name: string): string | null }): Record<string, string> {
  const xff = from?.get("x-forwarded-for")?.trim();
  return xff ? { "x-forwarded-for": xff.slice(0, 500) } : {};
}

/**
 * Calls an API endpoint that returns `{ token, expiresIn, user }` (login, signup) and moves the JWT
 * into the httpOnly session cookie; the browser only receives `user`.
 */
export async function startSession(path: "auth/login" | "auth/signup", body: string, from?: { get(name: string): string | null }): Promise<NextResponse> {
  const res = await fetch(`${apiBase()}/api/v1/${path}`, { method: "POST", headers: { "content-type": "application/json", ...forwardedFor(from) }, body, cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as { token?: string; expiresIn?: number; user?: unknown; error?: unknown };
  if (!res.ok || !json.token) return NextResponse.json({ error: json.error ?? { message: "Falha na autenticação" } }, { status: res.ok ? 401 : res.status });
  const out = NextResponse.json({ user: json.user ?? null }, { status: res.status });
  out.cookies.set(SESSION_COOKIE, json.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: (process.env.NEXT_PUBLIC_APP_URL ?? "").startsWith("https://"),
    path: "/",
    maxAge: json.expiresIn ?? 8 * 3600,
  });
  return out;
}
