import { defineConfig } from "vitest/config";

/**
 * Three test projects:
 *  - unit:        pure logic, no infrastructure (pricing, optimization, providers, security helpers)
 *  - integration: requires PostgreSQL + Redis (DATABASE_URL / REDIS_URL)
 *  - e2e:         boots API + worker in-process and drives the whole pipeline over HTTP
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "scripts/**/*.test.ts"],
          exclude: ["**/*.int.test.ts", "**/*.e2e.test.ts", "**/node_modules/**", "apps/web/**"],
          environment: "node",
        },
      },
      {
        test: {
          name: "integration",
          include: ["packages/**/*.int.test.ts", "apps/**/*.int.test.ts"],
          exclude: ["**/node_modules/**", "apps/web/**"],
          environment: "node",
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
      {
        test: {
          name: "e2e",
          include: ["apps/**/*.e2e.test.ts", "tests/**/*.e2e.test.ts"],
          exclude: ["**/node_modules/**", "apps/web/**"],
          environment: "node",
          fileParallelism: false,
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
