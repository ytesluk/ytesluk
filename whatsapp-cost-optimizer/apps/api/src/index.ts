import { loadConfig } from "@wco/config";
import { createRootLogger, enableDefaultMetrics } from "@wco/logging";
import { createAppContext } from "@wco/services";
import { buildApp } from "./app";

process.env.WCO_SERVICE = "api";
const config = loadConfig();
const logger = createRootLogger({ service: "api", level: config.env.LOG_LEVEL });
enableDefaultMetrics("api");
const ctx = createAppContext({ config, service: "api" });
const app = await buildApp(ctx);
await app.listen({ port: config.env.API_PORT, host: config.env.API_HOST });
logger.info({ port: config.env.API_PORT, mode: config.mode, mock: config.meta.mock }, "api started — docs at /api/docs");

const shutdown = async (signal: string) => {
  logger.info({ signal }, "api shutting down");
  await app.close();
  await ctx.close();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
