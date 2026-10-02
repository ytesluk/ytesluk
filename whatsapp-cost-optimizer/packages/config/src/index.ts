import { EnvSchema, type Env } from "./env";
import { createSecretProvider, type SecretProvider } from "./secrets";
import { parseKey } from "./crypto";

export * from "./env";
export * from "./secrets";
export * from "./crypto";

export interface AppConfig {
  env: Env;
  mode: "development" | "production";
  isProduction: boolean;
  secrets: SecretProvider;
  encryptionKey: Buffer;
  jwtSecret: string;
  hashPepper: string;
  meta: {
    mock: boolean;
    appId?: string;
    graphApiVersion?: string;
    graphApiBaseUrl: string;
    webhookVerifyToken?: string;
    appSecret?: string;
    partnerType?: string;
    embeddedSignupConfigId?: string;
    advancedAccessConfirmed: boolean;
    timeoutMs: number;
    devCredentials: { accessToken?: string; wabaId?: string; phoneNumberId?: string };
  };
}

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid configuration:\n - ${problems.join("\n - ")}`);
    this.name = "ConfigError";
  }
}

let cached: AppConfig | undefined;

/** Loads and validates configuration. Production mode fails fast on unsafe settings. */
export function loadConfig(source: Record<string, string | undefined> = process.env, opts: { cache?: boolean } = {}): AppConfig {
  if (cached && opts.cache !== false && source === process.env) return cached;
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  const env = parsed.data;
  const secrets = createSecretProvider({
    kind: env.SECRET_PROVIDER,
    appMode: env.APP_MODE,
    env: source,
    secretsDir: env.SECRETS_DIR,
  });

  const problems: string[] = [];
  const isProduction = env.APP_MODE === "production";
  const encryptionKeyB64 = secrets.get("ENCRYPTION_KEY");
  const jwtSecret = secrets.get("JWT_SECRET");
  const hashPepper = secrets.get("HASH_PEPPER");
  let encryptionKey: Buffer = Buffer.alloc(32);
  if (!encryptionKeyB64) problems.push("ENCRYPTION_KEY is required");
  else {
    try {
      encryptionKey = parseKey(encryptionKeyB64);
    } catch (e) {
      problems.push((e as Error).message);
    }
  }
  if (!jwtSecret || jwtSecret.length < 32) problems.push("JWT_SECRET must have at least 32 characters");
  if (!hashPepper || hashPepper.length < 16) problems.push("HASH_PEPPER must have at least 16 characters");

  if (isProduction) {
    if (env.MOCK_WHATSAPP && !env.ALLOW_MOCK_IN_PRODUCTION) {
      problems.push("MOCK_WHATSAPP=true is not allowed in production (set ALLOW_MOCK_IN_PRODUCTION=true for staging only)");
    }
    if (!env.MOCK_WHATSAPP) {
      if (!secrets.get("META_APP_SECRET")) problems.push("META_APP_SECRET is required to verify webhook signatures");
      if (!secrets.get("META_WEBHOOK_VERIFY_TOKEN")) problems.push("META_WEBHOOK_VERIFY_TOKEN is required");
      if (!env.META_GRAPH_API_VERSION) problems.push("META_GRAPH_API_VERSION is required (e.g. v26.0)");
    }
  }
  if (!env.MOCK_WHATSAPP && !env.META_GRAPH_API_VERSION) {
    problems.push("META_GRAPH_API_VERSION is required when MOCK_WHATSAPP=false");
  }
  if (problems.length > 0) throw new ConfigError(problems);

  const config: AppConfig = {
    env,
    mode: env.APP_MODE,
    isProduction,
    secrets,
    encryptionKey,
    jwtSecret: jwtSecret as string,
    hashPepper: hashPepper as string,
    meta: {
      mock: env.MOCK_WHATSAPP,
      appId: env.META_APP_ID,
      graphApiVersion: env.META_GRAPH_API_VERSION,
      graphApiBaseUrl: env.META_GRAPH_API_BASE_URL,
      webhookVerifyToken: secrets.get("META_WEBHOOK_VERIFY_TOKEN"),
      appSecret: secrets.get("META_APP_SECRET"),
      partnerType: env.META_PARTNER_TYPE,
      embeddedSignupConfigId: env.META_EMBEDDED_SIGNUP_CONFIG_ID,
      advancedAccessConfirmed: env.META_ADVANCED_ACCESS_CONFIRMED,
      timeoutMs: env.META_HTTP_TIMEOUT_MS,
      devCredentials: {
        accessToken: secrets.get("META_ACCESS_TOKEN"),
        wabaId: env.META_WABA_ID,
        phoneNumberId: env.META_PHONE_NUMBER_ID,
      },
    },
  };
  if (source === process.env && opts.cache !== false) cached = config;
  return config;
}

export function resetConfigCache(): void {
  cached = undefined;
}

/**
 * Spec §69: production must NOT onboard third-party businesses unless the app is a Meta
 * Tech Provider / Solution Partner with Embedded Signup configured and advanced access approved.
 */
export function commercialOnboardingStatus(config: AppConfig): { allowed: boolean; missing: string[] } {
  if (!config.isProduction) return { allowed: true, missing: [] };
  const missing: string[] = [];
  if (!config.meta.partnerType) missing.push("META_PARTNER_TYPE (TECH_PROVIDER | TECH_PARTNER | SOLUTION_PARTNER)");
  if (!config.meta.appId) missing.push("META_APP_ID");
  if (!config.meta.appSecret) missing.push("META_APP_SECRET");
  if (!config.meta.embeddedSignupConfigId) missing.push("META_EMBEDDED_SIGNUP_CONFIG_ID");
  if (!config.meta.advancedAccessConfirmed) {
    missing.push("META_ADVANCED_ACCESS_CONFIRMED=true (whatsapp_business_management/whatsapp_business_messaging advanced access)");
  }
  if (config.meta.mock) missing.push("MOCK_WHATSAPP=false");
  return { allowed: missing.length === 0, missing };
}
