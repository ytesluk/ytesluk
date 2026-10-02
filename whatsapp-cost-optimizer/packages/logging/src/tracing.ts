import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Logger } from "pino";

/**
 * Minimal tracing abstraction (spec §47). Spans are propagated with AsyncLocalStorage and exported to
 * the structured logger. The interface mirrors OpenTelemetry so an OTel exporter can replace
 * `LogSpanExporter` without touching call sites.
 */
export interface Span {
  readonly traceId: string;
  readonly spanId: string;
  readonly name: string;
  setAttribute(key: string, value: string | number | boolean): void;
  recordError(error: unknown): void;
  end(): void;
}

export interface SpanExporter {
  export(span: FinishedSpan): void;
}

export interface FinishedSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startedAt: number;
  durationMs: number;
  attributes: Record<string, string | number | boolean>;
  error?: string;
}

const storage = new AsyncLocalStorage<Span>();

export class NoopSpanExporter implements SpanExporter {
  export(): void {}
}

export class LogSpanExporter implements SpanExporter {
  constructor(private readonly logger: Logger) {}
  export(span: FinishedSpan): void {
    this.logger.debug({ span }, "span");
  }
}

let exporter: SpanExporter = new NoopSpanExporter();

export function setSpanExporter(e: SpanExporter): void {
  exporter = e;
}

class SimpleSpan implements Span {
  readonly spanId = randomUUID().replace(/-/g, "").slice(0, 16);
  private readonly startedAt = Date.now();
  private readonly attributes: Record<string, string | number | boolean> = {};
  private error?: string;
  private ended = false;

  constructor(
    readonly name: string,
    readonly traceId: string,
    private readonly parentSpanId?: string,
  ) {}

  setAttribute(key: string, value: string | number | boolean): void {
    this.attributes[key] = value;
  }

  recordError(error: unknown): void {
    this.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    exporter.export({
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
      name: this.name,
      startedAt: this.startedAt,
      durationMs: Date.now() - this.startedAt,
      attributes: this.attributes,
      error: this.error,
    });
  }
}

export function currentSpan(): Span | undefined {
  return storage.getStore();
}

export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes: Record<string, string | number | boolean> = {},
): Promise<T> {
  const parent = storage.getStore();
  const span = new SimpleSpan(name, parent?.traceId ?? randomUUID().replace(/-/g, ""), parent?.spanId);
  for (const [k, v] of Object.entries(attributes)) span.setAttribute(k, v);
  return storage.run(span, async () => {
    try {
      return await fn(span);
    } catch (e) {
      span.recordError(e);
      throw e;
    } finally {
      span.end();
    }
  });
}
