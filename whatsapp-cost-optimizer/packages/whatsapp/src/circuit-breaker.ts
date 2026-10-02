/**
 * Circuit breaker (spec §104). Opens when the error RATE over a rolling window exceeds the threshold
 * (with a minimum number of calls), rejects calls while OPEN, then lets a single probe through
 * (HALF_OPEN). Rejected calls are retried later by the queue (backpressure, spec §103).
 */
export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  windowMs: number;
  minCalls: number;
  failureRateThreshold: number; // 0..1
  openMs: number;
  onStateChange?: (state: CircuitState) => void;
  now?: () => number;
}

export class CircuitOpenError extends Error {
  readonly retryable = true;
  constructor(readonly retryAfterMs: number) {
    super("Circuit breaker is open: provider error rate too high");
    this.name = "CircuitOpenError";
  }
}

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private openedAt = 0;
  private calls: Array<{ t: number; ok: boolean }> = [];
  private probing = false;
  private readonly now: () => number;

  constructor(private readonly opts: CircuitBreakerOptions) {
    this.now = opts.now ?? Date.now;
  }

  get currentState(): CircuitState {
    if (this.state === "OPEN" && this.now() - this.openedAt >= this.opts.openMs) this.setState("HALF_OPEN");
    return this.state;
  }

  private setState(s: CircuitState): void {
    if (this.state !== s) {
      this.state = s;
      this.opts.onStateChange?.(s);
    }
  }

  private record(ok: boolean, retryableFailure: boolean): void {
    const t = this.now();
    // Only failures that indicate provider health count (not "invalid template" etc.).
    if (!ok && !retryableFailure) return;
    this.calls.push({ t, ok });
    const since = t - this.opts.windowMs;
    while (this.calls.length && this.calls[0]!.t < since) this.calls.shift();
  }

  private failureRate(): number {
    if (this.calls.length < this.opts.minCalls) return 0;
    return this.calls.filter((c) => !c.ok).length / this.calls.length;
  }

  async exec<T>(fn: () => Promise<T>, isRetryableFailure: (e: unknown) => boolean = () => true): Promise<T> {
    const state = this.currentState;
    if (state === "OPEN") throw new CircuitOpenError(this.opts.openMs - (this.now() - this.openedAt));
    if (state === "HALF_OPEN") {
      if (this.probing) throw new CircuitOpenError(1_000);
      this.probing = true;
    }
    try {
      const r = await fn();
      this.record(true, false);
      if (state === "HALF_OPEN") {
        this.calls = [];
        this.setState("CLOSED");
      }
      return r;
    } catch (e) {
      const retryable = isRetryableFailure(e);
      this.record(false, retryable);
      if (state === "HALF_OPEN" && retryable) {
        this.openedAt = this.now();
        this.setState("OPEN");
      } else if (this.failureRate() >= this.opts.failureRateThreshold) {
        this.openedAt = this.now();
        this.setState("OPEN");
      }
      throw e;
    } finally {
      if (state === "HALF_OPEN") this.probing = false;
    }
  }
}
