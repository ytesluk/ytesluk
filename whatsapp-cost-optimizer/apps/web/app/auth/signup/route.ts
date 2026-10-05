import { NextResponse, type NextRequest } from "next/server";
import { startSession } from "@/lib/server";
import { sameOrigin } from "@/lib/origin";

/** POST: self-service account creation; on success the user is signed in (httpOnly cookie). */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: { code: "FORBIDDEN", message: "Origem inválida" } }, { status: 403 });
  return startSession("auth/signup", await req.text());
}
