import { z } from "zod";

const bool = (def: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === "") return def;
      if (typeof v === "boolean") return v;
      return ["1", "true", "yes", "on"].includes(v.toLowerCase());
    });

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === "" ? undefined : v.trim()));

export const EnvSchema = z.object({
  APP_MODE: z.enum(["development", "production"]).default("development"),
  NODE_ENV: z.string().default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  DATABASE_URL: z.string().min(1).default("postgresql://wco:wco@localhost:5432/wco"),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  API_HOST: z.string().default("0.0.0.0"),
  API_PUBLIC_URL: z.string().default("http://localhost:4000"),
  API_INTERNAL_URL: z.string().default("http://localhost:4000"),
  NEXT_PUBLIC_APP_URL: z.string().default("http://localhost:3000"),
  CORS_ORIGINS: optionalString,

  ENCRYPTION_KEY: optionalString,
  JWT_SECRET: optionalString,
  JWT_TTL_SECONDS: z.coerce.number().int().positive().default(8 * 3600),
  HASH_PEPPER: optionalString,
  SECRET_PROVIDER: z.enum(["development", "docker", "production"]).default("development"),
  SECRETS_DIR: z.string().default("/run/secrets"),

  MOCK_WHATSAPP: bool(true),
  ALLOW_MOCK_IN_PRODUCTION: bool(false),
  META_APP_ID: optionalString,
  META_APP_SECRET: optionalString,
  META_GRAPH_API_VERSION: optionalString,
  META_GRAPH_API_BASE_URL: z.string().default("https://graph.facebook.com"),
  META_WEBHOOK_VERIFY_TOKEN: optionalString,
  META_ACCESS_TOKEN: optionalString,
  META_WABA_ID: optionalString,
  META_PHONE_NUMBER_ID: optionalString,
  META_PARTNER_TYPE: z
    .union([z.enum(["TECH_PROVIDER", "TECH_PARTNER", "SOLUTION_PARTNER"]), z.literal("")])
    .optional()
    .transform((v) => (v ? v : undefined)),
  META_EMBEDDED_SIGNUP_CONFIG_ID: optionalString,
  META_ADVANCED_ACCESS_CONFIRMED: bool(false),
  META_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  INFRA_COST_PER_MESSAGE_PROCESSED: z.string().default("0.00002"),
  INFRA_COST_PER_PROVIDER_CALL: z.string().default("0.00005"),
  INFRA_CURRENCY: z.string().default("BRL"),

  AI_ASSISTANT_ENABLED: bool(false),
  AI_ASSISTANT_PROVIDER: optionalString,
  AI_ASSISTANT_API_KEY: optionalString,
  AI_ASSISTANT_MODEL: optionalString,
  AI_ASSISTANT_COST_PER_CALL: z.string().default("0"),

  MOCK_DELIVERY_RATE: z.coerce.number().min(0).max(1).default(0.97),
  MOCK_READ_RATE: z.coerce.number().min(0).max(1).default(0.6),
  MOCK_MAX_LATENCY_MS: z.coerce.number().int().min(0).default(1500),

  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(600),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(10),
  DISPATCH_MAX_PER_SECOND: z.coerce.number().int().positive().default(80),
  ENABLE_SCHEDULED_JOBS: bool(true),
});

export type Env = z.infer<typeof EnvSchema>;
