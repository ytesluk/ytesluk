/**
 * pnpm db:seed — demo tenants, users, DEMO pricing, templates, policies and ~30 days of demo traffic.
 * Development credentials are printed once; never use them in production.
 */
import { createAppContext, seedAll } from "@wco/services";

const ctx = createAppContext({ service: "seed", subscribe: false });
const started = Date.now();
try {
  const r = await seedAll(ctx, { demoHistory: !process.argv.includes("--no-history") });
  console.log("Seed concluído em", Date.now() - started, "ms");
  console.log(JSON.stringify(r, null, 2));
  console.log("Logins (dev): owner@loja-demo.wco.dev / admin@ / analyst@ / operator@  · senha:", r.password);
} finally {
  await ctx.close();
}
