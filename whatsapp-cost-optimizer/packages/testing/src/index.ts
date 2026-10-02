import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Shared helpers for integration and E2E tests. Tests run against a dedicated database
 * (`wco_test`) and Redis logical DB 15 so they never touch development data.
 */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://wco:wco@localhost:5432/wco_test";
export const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://localhost:6379/15";
export const TEST_APP_SECRET = "wco-test-app-secret";
export const TEST_VERIFY_TOKEN = "wco-test-verify-token";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Points every config loader at the test infrastructure. Call before creating an AppContext. */
export function useTestEnv(extra: Record<string, string> = {}): void {
  Object.assign(process.env, {
    APP_MODE: "development",
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    DATABASE_URL: TEST_DATABASE_URL,
    DATABASE_POOL_MAX: "5",
    REDIS_URL: TEST_REDIS_URL,
    ENCRYPTION_KEY: "d2NvLXRlc3QtZW5jcnlwdGlvbi1rZXktMzItYnl0ZXM=",
    JWT_SECRET: "test-jwt-secret-with-enough-entropy-0123456789",
    HASH_PEPPER: "test-hash-pepper",
    SECRET_PROVIDER: "development",
    MOCK_WHATSAPP: "true",
    META_APP_SECRET: TEST_APP_SECRET,
    META_WEBHOOK_VERIFY_TOKEN: TEST_VERIFY_TOKEN,
    META_GRAPH_API_VERSION: "v26.0",
    MOCK_DELIVERY_RATE: "1",
    MOCK_READ_RATE: "0",
    MOCK_MAX_LATENCY_MS: "50",
    ENABLE_SCHEDULED_JOBS: "false",
    RATE_LIMIT_PER_MINUTE: "10000",
    ...extra,
  });
}

/** Applies migrations to the test database (idempotent). */
export function migrateTestDatabase(): void {
  execSync("pnpm --filter @wco/database exec prisma migrate deploy", {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "pipe",
  });
}

interface RawDb {
  $queryRawUnsafe<T = unknown>(sql: string): Promise<T>;
  $executeRawUnsafe(sql: string): Promise<number>;
}

/** Empties every table (keeps the schema and migration history). */
export async function truncateAll(db: RawDb): Promise<void> {
  const rows = await db.$queryRawUnsafe<Array<{ tablename: string }>>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'",
  );
  if (!rows.length) return;
  await db.$executeRawUnsafe(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

/** Polls `fn` until it returns a truthy value (or throws after `timeoutMs`). */
export async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, opts: { timeoutMs?: number; intervalMs?: number; label?: string } = {}): Promise<T> {
  const deadline = Date.now() + (opts.timeoutMs ?? 30_000);
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, opts.intervalMs ?? 200));
  }
  throw new Error(`waitFor timed out${opts.label ? ` (${opts.label})` : ""}${last ? `: ${String(last)}` : ""}`);
}

/** A Meta-shaped `messages` status webhook (same structure as the Cloud API sends). */
export function statusWebhook(input: {
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber?: string;
  providerMessageId: string;
  recipientWaId: string;
  status: "sent" | "delivered" | "read" | "failed";
  timestamp?: number;
  pricing?: { billable: boolean; pricing_model: string; category: string; type?: string };
}): Record<string, unknown> {
  const ts = String(input.timestamp ?? Math.floor(Date.now() / 1000));
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: input.wabaId,
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: input.displayPhoneNumber ?? "5511400000001", phone_number_id: input.phoneNumberId },
              statuses: [
                {
                  id: input.providerMessageId,
                  status: input.status,
                  timestamp: ts,
                  recipient_id: input.recipientWaId,
                  ...(input.pricing ? { pricing: input.pricing } : {}),
                },
              ],
            },
          },
        ],
      },
    ],
  };
}
