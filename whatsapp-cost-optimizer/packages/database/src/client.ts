import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

export type Db = InstanceType<typeof PrismaClient>;

const clients = new Map<string, Db>();

/**
 * One pooled client per connection string per process (spec §53: connection pooling).
 * `max` bounds the pg pool; use PgBouncer/managed pooling in production.
 */
export function getDb(databaseUrl = process.env.DATABASE_URL ?? "postgresql://wco:wco@localhost:5432/wco", poolMax = Number(process.env.DATABASE_POOL_MAX ?? 10)): Db {
  const existing = clients.get(databaseUrl);
  if (existing) return existing;
  const adapter = new PrismaPg({ connectionString: databaseUrl, max: poolMax });
  const client = new PrismaClient({ adapter });
  clients.set(databaseUrl, client);
  return client;
}

export async function disconnectAll(): Promise<void> {
  await Promise.all([...clients.values()].map((c) => c.$disconnect()));
  clients.clear();
}
