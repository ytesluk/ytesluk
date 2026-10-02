import { cookies } from "next/headers";

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
