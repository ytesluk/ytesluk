import { pino, type Logger, type LoggerOptions } from "pino";
import { PINO_REDACT_PATHS } from "./redact";

export type { Logger };

let root: Logger | undefined;

export function createRootLogger(opts: { level?: string; service: string; pretty?: boolean }): Logger {
  const options: LoggerOptions = {
    level: opts.level ?? process.env.LOG_LEVEL ?? "info",
    base: { service: opts.service },
    redact: { paths: PINO_REDACT_PATHS, censor: "[REDACTED]" },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
  };
  if (opts.pretty) {
    options.transport = { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:standard" } };
  }
  root = pino(options);
  return root;
}

export function getLogger(component?: string): Logger {
  if (!root) {
    root = createRootLogger({
      service: process.env.WCO_SERVICE ?? "wco",
      level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
    });
  }
  return component ? root.child({ component }) : root;
}
