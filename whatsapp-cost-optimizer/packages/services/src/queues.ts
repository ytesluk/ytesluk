import { Queue, type ConnectionOptions, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";

/**
 * BullMQ queues (spec §11). Workers consume with blocking Redis commands — no polling loops.
 *
 *   optimize   → run the decision engine for a new intent
 *   flush      → leave the buffer for a group at its (debounced) flush time
 *   dispatch   → send to the provider (rate-limited, retried with exponential backoff)
 *   webhook    → process a persisted raw webhook event
 *   mock-emit  → (MOCK mode) deliver simulated Meta status webhooks to our own endpoint
 *   maintenance→ repeatable rollups, anomaly detection, retention
 *   dead-letter→ jobs that exhausted their retries (inspected in Admin > Webhooks / Queues)
 */
export const QUEUE = {
  OPTIMIZE: "wco-optimize",
  FLUSH: "wco-flush",
  DISPATCH: "wco-dispatch",
  WEBHOOK: "wco-webhook",
  MOCK_EMIT: "wco-mock-emit",
  MAINTENANCE: "wco-maintenance",
  DEAD_LETTER: "wco-dead-letter",
} as const;
export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

export interface OptimizeJob {
  tenantId: string;
  intentId: string;
}
export interface FlushJob {
  tenantId: string;
  groupKey: string;
}
export interface DispatchJob {
  tenantId: string;
  attemptId: string;
}
export interface WebhookJob {
  webhookEventId: string;
}
export interface MockEmitJob {
  payload: Record<string, unknown>;
}
export interface MaintenanceJob {
  task: "rollup" | "anomalies" | "retention" | "alerts";
}
export interface DeadLetterJob {
  queue: string;
  jobId?: string;
  name: string;
  data: unknown;
  failedReason: string;
  attemptsMade: number;
}

export const DEFAULT_JOB_OPTIONS: Record<QueueName, JobsOptions> = {
  [QUEUE.OPTIMIZE]: { attempts: 5, backoff: { type: "exponential", delay: 500 }, removeOnComplete: { count: 1000 }, removeOnFail: { count: 5000 } },
  [QUEUE.FLUSH]: { attempts: 5, backoff: { type: "exponential", delay: 500 }, removeOnComplete: true, removeOnFail: { count: 5000 } },
  // Retry limit + exponential backoff (spec §27): ~2s, 4s, 8s, ... up to 8 attempts, then dead-letter.
  [QUEUE.DISPATCH]: { attempts: 8, backoff: { type: "exponential", delay: 2000 }, removeOnComplete: { count: 2000 }, removeOnFail: { count: 5000 } },
  [QUEUE.WEBHOOK]: { attempts: 6, backoff: { type: "exponential", delay: 1000 }, removeOnComplete: { count: 2000 }, removeOnFail: { count: 5000 } },
  [QUEUE.MOCK_EMIT]: { attempts: 3, backoff: { type: "fixed", delay: 1000 }, removeOnComplete: true, removeOnFail: { count: 500 } },
  [QUEUE.MAINTENANCE]: { attempts: 2, removeOnComplete: { count: 100 }, removeOnFail: { count: 100 } },
  [QUEUE.DEAD_LETTER]: { removeOnComplete: false, removeOnFail: false },
};

export function createRedis(url: string): Redis {
  // maxRetriesPerRequest: null is required by BullMQ for blocking commands.
  return new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: true, lazyConnect: false });
}

export type Queues = Record<QueueName, Queue>;

export function createQueues(connection: ConnectionOptions): Queues {
  const q = {} as Queues;
  for (const name of Object.values(QUEUE)) {
    q[name] = new Queue(name, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS[name] });
  }
  return q;
}

export async function queueDepths(queues: Queues): Promise<Array<{ queue: string; waiting: number; delayed: number; active: number; failed: number; completed: number }>> {
  return Promise.all(
    Object.values(queues).map(async (q) => {
      const c = await q.getJobCounts("waiting", "delayed", "active", "failed", "completed");
      return { queue: q.name, waiting: c.waiting ?? 0, delayed: c.delayed ?? 0, active: c.active ?? 0, failed: c.failed ?? 0, completed: c.completed ?? 0 };
    }),
  );
}
