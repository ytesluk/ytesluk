import type { NextRequest } from "next/server";

/**
 * CSRF defence for state-changing BFF calls: the browser's Origin (or Referer) must be one of this
 * deployment's own hosts. Combined with SameSite=Lax session cookies.
 *
 * Behind port-forwarding proxies (e.g. GitHub Codespaces) the server sees `localhost:3000` while the
 * browser sends the public hostname, so the public origin must be declared:
 *   - WEB_ALLOWED_ORIGINS: comma-separated origins (e.g. https://wco.example.com)
 *   - CODESPACE_NAME + GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: the codespace's own forwarded URL
 * Read at runtime (not NEXT_PUBLIC_*, which would be inlined at build time).
 */
function hostOf(value: string | undefined | null): string | null {
  if (!value) return null;
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).host;
  } catch {
    return null;
  }
}

export function allowedHosts(headers: { get(name: string): string | null }, env: Record<string, string | undefined> = process.env): Set<string> {
  const hosts = new Set<string>();
  const add = (v: string | null | undefined) => {
    const h = hostOf(v);
    if (h) hosts.add(h);
  };
  add(headers.get("host"));
  add(headers.get("x-forwarded-host")?.split(",")[0]?.trim());
  for (const o of (env.WEB_ALLOWED_ORIGINS ?? "").split(",")) add(o.trim());
  if (env.CODESPACE_NAME && env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN) {
    add(`${env.CODESPACE_NAME}-${env.PORT ?? "3000"}.${env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`);
  }
  return hosts;
}

export function sameOrigin(req: Pick<NextRequest, "method" | "headers">, env: Record<string, string | undefined> = process.env): boolean {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD") return true;
  const originHost = hostOf(req.headers.get("origin") ?? req.headers.get("referer"));
  if (!originHost) return false;
  return allowedHosts(req.headers, env).has(originHost);
}
