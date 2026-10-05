import { resolve } from "node:path";
import type { NextConfig } from "next";

/**
 * Dashboard (BFF). The browser never sees the API JWT: it lives in an httpOnly cookie and every
 * call goes through /bff/* route handlers, which forward to the API (API_INTERNAL_URL).
 */
const dev = process.env.NODE_ENV !== "production";
const csp = (extra: { script?: string; frame?: string; connect?: string; img?: string } = {}) =>
  [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}${extra.script ? ` ${extra.script}` : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data:${extra.img ? ` ${extra.img}` : ""}`,
    `connect-src 'self'${extra.connect ? ` ${extra.connect}` : ""}`,
    ...(extra.frame ? [`frame-src ${extra.frame}`] : []),
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");

/** Only the Embedded Signup page may load Meta's JavaScript SDK (popup + its helper iframes). */
const FACEBOOK = "https://connect.facebook.net https://*.facebook.com";
const embeddedSignupCsp = csp({ script: "https://connect.facebook.net", frame: "https://*.facebook.com", connect: FACEBOOK, img: FACEBOOK });

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Content-Security-Policy", value: csp() },
];

const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: resolve(import.meta.dirname, "../.."),
  poweredByHeader: false,
  reactStrictMode: true,
  agentRules: false,
  async headers() {
    // Later entries override earlier ones for the same header key.
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/admin/providers/embedded-signup", headers: [{ key: "Content-Security-Policy", value: embeddedSignupCsp }] },
    ];
  },
};

export default config;
