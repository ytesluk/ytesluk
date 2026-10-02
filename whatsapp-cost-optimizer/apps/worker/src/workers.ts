import { DelayedError, Worker, type Job, type Processor } from "bullmq";
import { metrics } from "@wco/logging";
import {
  QUEUE,
  RetryLaterError,
  applyRetention,
  dispatchAttempt,
  evaluateAlerts,
  flushGroup,
  optimizeIntent,
  processWebhook,
  rollupDailyMetrics,
  type AppContext,
  type DeadLetterJob,
  type DispatchJob,
  type FlushJob,
  type MaintenanceJob,
  type MockEmitJob,
  type OptimizeJob,
  type WebhookJob,
} from "@wco/services";
import { computeSignature } from "@wco/whatsapp";

/**
 * BullMQ workers (spec §11, §27). Horizontally scalable: run N replicas; serialization per buffer group
 * is guaranteed by PostgreSQL advisory locks, idempotency by unique keys.
 */
const isFinal = (job: Job) => job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

export function startWorkers(ctx: AppContext): Worker[] {
  const connection = ctx.redis;
  const concurrency = ctx.config.env.WORKER_CONCURRENCY;
  const log = ctx.log;

  const make = <T>(name: string, processor: Processor<T>, opts: { concurrency?: number; limiter?: { max: number; duration: number } } = {}) => {
    const w = new Worker<T>(name, processor, { connection, concurrency: opts.concurrency ?? concurrency, limiter: opts.limiter, autorun: true });
    w.on("failed", async (job, err) => {
      if (!job) return;
      log.warn({ queue: name, jobId: job.id, attemptsMade: job.attemptsMade, err: err.message }, "job failed");
      if (job.attemptsMade >= (job.opts.attempts ?? 1)) {
        // Dead-letter queue: exhausted retries are kept for inspection, never retried forever (spec §27).
        const dl: DeadLetterJob = { queue: name, jobId: job.id, name: job.name, data: job.data, failedReason: err.message, attemptsMade: job.attemptsMade };
        await ctx.queues[QUEUE.DEAD_LETTER].add("dead-letter", dl).catch(() => undefined);
      }
    });
    w.on("error", (err) => log.error({ queue: name, err: err.message }, "worker error"));
    return w;
  };

  const optimize = make<OptimizeJob>(QUEUE.OPTIMIZE, async (job) => optimizeIntent(ctx, job.data));
  const flush = make<FlushJob>(QUEUE.FLUSH, async (job) => flushGroup(ctx, job.data));

  // Global limiter across all worker replicas (Cloud API default throughput: 80 mps per number, S9).
  const dispatch = make<DispatchJob>(
    QUEUE.DISPATCH,
    async (job, token) => {
      try {
        return await dispatchAttempt(ctx, job.data, { finalAttempt: isFinal(job) });
      } catch (e) {
        if (e instanceof RetryLaterError) {
          // Respect pair rate limit / open circuit: move back to delayed without consuming an attempt.
          await job.moveToDelayed(Date.now() + e.delayMs, token);
          throw new DelayedError();
        }
        throw e;
      }
    },
    { limiter: { max: ctx.config.env.DISPATCH_MAX_PER_SECOND, duration: 1000 } },
  );

  const webhook = make<WebhookJob>(QUEUE.WEBHOOK, async (job) => processWebhook(ctx, job.data, { finalAttempt: isFinal(job) }));

  // MOCK mode: deliver simulated Meta webhooks to our own endpoint (signed like Meta does).
  const mockEmit = make<MockEmitJob>(
    QUEUE.MOCK_EMIT,
    async (job) => {
      const body = JSON.stringify(job.data.payload);
      const res = await fetch(`${ctx.config.env.API_INTERNAL_URL}/api/v1/webhooks/meta`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Hub-Signature-256": computeSignature(body, ctx.config.meta.appSecret ?? "wco-dev-app-secret") },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Webhook endpoint answered ${res.status}`);
      return { status: res.status };
    },
    { concurrency: 20 },
  );

  const maintenance = make<MaintenanceJob>(
    QUEUE.MAINTENANCE,
    async (job) => {
      switch (job.data.task) {
        case "rollup":
          return { rows: await rollupDailyMetrics(ctx) };
        case "alerts":
          return { raised: await evaluateAlerts(ctx) };
        case "retention":
          return applyRetention(ctx);
        default:
          return null;
      }
    },
    { concurrency: 1 },
  );

  return [optimize, flush, dispatch, webhook, mockEmit, maintenance];
}

/** Repeatable maintenance jobs (internal batch work — no polling of WhatsApp). */
export async function scheduleMaintenance(ctx: AppContext): Promise<void> {
  const q = ctx.queues[QUEUE.MAINTENANCE];
  await q.upsertJobScheduler("rollup", { every: 10 * 60_000 }, { name: "rollup", data: { task: "rollup" } });
  await q.upsertJobScheduler("alerts", { every: 15 * 60_000 }, { name: "alerts", data: { task: "alerts" } });
  await q.upsertJobScheduler("retention", { pattern: "30 6 * * *" }, { name: "retention", data: { task: "retention" } });
}

export async function updateQueueMetrics(ctx: AppContext): Promise<void> {
  for (const q of Object.values(ctx.queues)) {
    const c = await q.getJobCounts("waiting", "delayed", "active", "failed");
    for (const [state, n] of Object.entries(c)) metrics.queueDepth.set({ queue: q.name, state }, n);
  }
}
