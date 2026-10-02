import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, apiBase } from "@/lib/server";
import { sameOrigin } from "@/lib/origin";

/** POST: login (stores the API JWT in an httpOnly cookie). DELETE: logout. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: { code: "FORBIDDEN", message: "Origem inválida" } }, { status: 403 });
  const body = await req.text();
  const res = await fetch(`${apiBase()}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body, cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as { token?: string; expiresIn?: number; user?: unknown; error?: unknown };
  if (!res.ok || !json.token) return NextResponse.json({ error: json.error ?? { message: "Falha no login" } }, { status: res.status === 200 ? 401 : res.status });
  const out = NextResponse.json({ user: json.user ?? null });
  out.cookies.set(SESSION_COOKIE, json.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: (process.env.NEXT_PUBLIC_APP_URL ?? "").startsWith("https://"),
    path: "/",
    maxAge: json.expiresIn ?? 8 * 3600,
  });
  return out;
}

export async function DELETE(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: { code: "FORBIDDEN" } }, { status: 403 });
  const out = NextResponse.json({ ok: true });
  out.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return out;
}
