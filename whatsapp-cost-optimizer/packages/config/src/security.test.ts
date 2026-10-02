import { describe, expect, it } from "vitest";
import { ConfigError, commercialOnboardingStatus, decrypt, encrypt, hashPassword, loadConfig, parseKey, verifyPassword } from "./index";

/** Security tests (spec §23, §41, §69): secrets at rest, password storage, production guards. */
const KEY_B64 = Buffer.alloc(32, 7).toString("base64");
const base = {
  ENCRYPTION_KEY: KEY_B64,
  JWT_SECRET: "x".repeat(40),
  HASH_PEPPER: "p".repeat(20),
};

describe("encryption at rest (AES-256-GCM)", () => {
  const key = parseKey(KEY_B64);

  it("round-trips and never contains the plaintext", () => {
    const token = "EAAG-fake-meta-access-token-123";
    const enc = encrypt(token, key);
    expect(enc).not.toContain(token);
    expect(decrypt(enc, key)).toBe(token);
    expect(encrypt(token, key)).not.toBe(enc); // random IV
  });

  it("detects tampering and wrong keys", () => {
    const enc = encrypt("+5511999999999", key);
    const parts = enc.split(":");
    const last = parts[parts.length - 1]!;
    parts[parts.length - 1] = (last[0] === "A" ? "B" : "A") + last.slice(1);
    expect(() => decrypt(parts.join(":"), key)).toThrow();
    expect(() => decrypt(enc, parseKey(Buffer.alloc(32, 9).toString("base64")))).toThrow();
  });

  it("rejects keys that are not 32 bytes", () => {
    expect(() => parseKey(Buffer.alloc(16).toString("base64"))).toThrow(/32 bytes/);
  });
});

describe("password hashing (scrypt)", () => {
  it("verifies the right password only and salts every hash", () => {
    const h = hashPassword("correct horse battery staple");
    expect(h).not.toContain("correct horse");
    expect(verifyPassword("correct horse battery staple", h)).toBe(true);
    expect(verifyPassword("wrong", h)).toBe(false);
    expect(hashPassword("correct horse battery staple")).not.toBe(h);
  });
});

describe("configuration guards", () => {
  it("requires strong secrets", () => {
    expect(() => loadConfig({ JWT_SECRET: "short" }, { cache: false })).toThrow(ConfigError);
  });

  it("refuses MOCK mode in production", () => {
    expect(() => loadConfig({ ...base, APP_MODE: "production", MOCK_WHATSAPP: "true" }, { cache: false })).toThrow(/MOCK_WHATSAPP/);
  });

  it("requires webhook secrets and a Graph API version for real Meta traffic in production", () => {
    expect(() => loadConfig({ ...base, APP_MODE: "production", MOCK_WHATSAPP: "false" }, { cache: false })).toThrow(/META_APP_SECRET|META_GRAPH_API_VERSION/);
  });

  it("blocks commercial onboarding in production without partner credentials (spec §69)", () => {
    const cfg = loadConfig({ ...base, APP_MODE: "production", MOCK_WHATSAPP: "false", META_APP_SECRET: "s", META_WEBHOOK_VERIFY_TOKEN: "v", META_GRAPH_API_VERSION: "v26.0" }, { cache: false });
    const s = commercialOnboardingStatus(cfg);
    expect(s.allowed).toBe(false);
    expect(s.missing.join(" ")).toMatch(/META_PARTNER_TYPE/);
  });

  it("development mode works with MOCK and no Meta credentials", () => {
    const cfg = loadConfig({ ...base }, { cache: false });
    expect(cfg.meta.mock).toBe(true);
    expect(commercialOnboardingStatus(cfg).allowed).toBe(true);
  });
});
