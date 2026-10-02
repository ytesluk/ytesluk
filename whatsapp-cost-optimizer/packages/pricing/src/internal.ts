export { Confidence, Money, PricingStatus, localDate } from "@wco/domain";
export type { Decimal } from "@wco/domain";

type UnknownHook = (reason: string) => void;
let hook: UnknownHook | undefined;

/** Lets the host app count UNKNOWN pricing outcomes without making this package depend on prom-client. */
export function setUnknownPricingHook(h: UnknownHook): void {
  hook = h;
}

export function metricsSafe(reason: string): void {
  try {
    hook?.(reason);
  } catch {
    /* metrics must never break pricing */
  }
}
