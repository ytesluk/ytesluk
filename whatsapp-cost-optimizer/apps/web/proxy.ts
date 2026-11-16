import { NextResponse, type NextRequest } from "next/server";

/**
 * Visitors without a session see the product page at "/"; signed-in users get the dashboard.
 * Only a cookie-presence check: the session itself is still validated by the app layout.
 */
export function proxy(req: NextRequest) {
  if (req.cookies.get("wco_session")?.value) return NextResponse.next();
  return NextResponse.rewrite(new URL("/inicio", req.url));
}

export const config = { matcher: "/" };
