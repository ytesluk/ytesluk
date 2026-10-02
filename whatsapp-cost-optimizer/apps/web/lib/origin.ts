import type { NextRequest } from "next/server";

/**
 * CSRF defence for state-changing BFF calls: the browser's Origin (or Referer) must match this
 * host. Combined with SameSite=Lax session cookies.
 */
export function sameOrigin(req: NextRequest): boolean {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD") return true;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const origin = req.headers.get("origin") ?? req.headers.get("referer");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
