/**
 * Uniform error shape (spec §56): code, message, retryable, provider, providerCode,
 * requestId, timestamp. Errors never carry secrets or full phone numbers.
 */
export interface AppErrorShape {
  code: string;
  message: string;
  retryable: boolean;
  provider?: string;
  providerCode?: string | number;
  requestId?: string;
  timestamp: string;
  httpStatus: number;
  details?: Record<string, unknown>;
}

export class AppError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly provider?: string;
  readonly providerCode?: string | number;
  requestId?: string;
  readonly timestamp: string;
  readonly httpStatus: number;
  readonly details?: Record<string, unknown>;

  constructor(init: Omit<AppErrorShape, "timestamp" | "retryable" | "httpStatus"> & {
    retryable?: boolean;
    httpStatus?: number;
    cause?: unknown;
  }) {
    super(init.message, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.name = "AppError";
    this.code = init.code;
    this.retryable = init.retryable ?? false;
    this.provider = init.provider;
    this.providerCode = init.providerCode;
    this.requestId = init.requestId;
    this.timestamp = new Date().toISOString();
    this.httpStatus = init.httpStatus ?? 500;
    this.details = init.details;
  }

  toJSON(): AppErrorShape {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      provider: this.provider,
      providerCode: this.providerCode,
      requestId: this.requestId,
      timestamp: this.timestamp,
      httpStatus: this.httpStatus,
      details: this.details,
    };
  }
}

export const Errors = {
  notFound: (what: string) => new AppError({ code: "NOT_FOUND", message: `${what} not found`, httpStatus: 404 }),
  forbidden: (message = "Forbidden") => new AppError({ code: "FORBIDDEN", message, httpStatus: 403 }),
  unauthorized: (message = "Unauthorized") => new AppError({ code: "UNAUTHORIZED", message, httpStatus: 401 }),
  validation: (message: string, details?: Record<string, unknown>) =>
    new AppError({ code: "VALIDATION_ERROR", message, httpStatus: 400, details }),
  conflict: (message: string) => new AppError({ code: "CONFLICT", message, httpStatus: 409 }),
  invalidTransition: (from: string, to: string) =>
    new AppError({ code: "INVALID_STATE_TRANSITION", message: `Invalid transition ${from} -> ${to}`, httpStatus: 409 }),
  configuration: (message: string) => new AppError({ code: "CONFIGURATION_ERROR", message, httpStatus: 500 }),
  pricingUnknown: (message: string) => new AppError({ code: "PRICING_UNKNOWN", message, httpStatus: 422 }),
};

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
