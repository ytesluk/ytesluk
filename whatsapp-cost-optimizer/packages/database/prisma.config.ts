import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx src/seed/index.ts",
  },
  datasource: {
    // Not using env() so `prisma generate` works without DATABASE_URL (e.g. in Docker builds).
    url: process.env.DATABASE_URL ?? "postgresql://wco:wco@localhost:5432/wco",
  },
});
