import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, startSession } from "@/lib/server";
import { sameOrigin } from "@/lib/origin";

/** POST: login (stores the API JWT in an httpOnly cookie). DELETE: logout. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: { code: "FORBIDDEN", message: "Origem inválida" } }, { status: 403 });
  return startSession("auth/login", await req.text());
}

export async function DELETE(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: { code: "FORBIDDEN" } }, { status: 403 });
  const out = NextResponse.json({ ok: true });
  out.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return out;
}
