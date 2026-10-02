import { createServer } from "node:http";
import { loadConfig } from "@wco/config";
import { createRootLogger, enableDefaultMetrics, metricsContentType, metricsText } from "@wco/logging";
import { createAppContext } from "@wco/services";
import { scheduleMaintenance, startWorkers, updateQueueMetrics } from "./workers";

process.env.WCO_SERVICE = "worker";
const config = loadConfig();
const logger = createRootLogger({ service: "worker", level: config.env.LOG_LEVEL, pretty: !config.isProduction && process.stdout.isTTY });
enableDefaultMetrics("worker");
const ctx = createAppContext({ config, service: "worker" });
const workers = startWorkers(ctx);
if (config.env.ENABLE_SCHEDULED_JOBS) await scheduleMaintenance(ctx);
const metricsTimer = setInterval(() => void updateQueueMetrics(ctx).catch(() => undefined), 15_000);

// Health + Prometheus metrics for the worker process.
const port = Number(process.env.WORKER_METRICS_PORT ?? 9100);
const server = createServer(async (req, res) => {
  if (req.url === "/health") {
    const redisOk = ctx.redis.status === "ready";
    res.writeHead(redisOk ? 200 : 503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: redisOk ? "ok" : "degraded", workers: workers.map((w) => ({ name: w.name, running: w.isRunning() })) }));
    return;
  }
  if (req.url === "/metrics") {
    res.writeHead(200, { "Content-Type": metricsContentType() });
    res.end(await metricsText());
    return;
  }
  res.writeHead(404).end();
});
server.listen(port, () => logger.info({ port, mock: config.meta.mock, mode: config.mode }, "worker started"));

const shutdown = async (signal: string) => {
  logger.info({ signal }, "worker shutting down");
  clearInterval(metricsTimer);
  server.close();
  await Promise.allSettled(workers.map((w) => w.close()));
  await ctx.close();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
