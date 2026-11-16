"use client";

import { setCalmMotion, useCalmMotion, useSystemReducesMotion } from "./motion";

/**
 * Footer switch for visitors whose system asks for less motion (and for anyone who already chose
 * the calm version): the page animates fully by default, this is the way to quiet it down.
 */
export function MotionSwitch({ className }: { className?: string }) {
  const calm = useCalmMotion();
  const systemReduces = useSystemReducesMotion();
  if (!calm && !systemReduces) return null;
  return (
    <button type="button" aria-pressed={calm} onClick={() => setCalmMotion(!calm)} className={className}>
      {calm ? "Ligar animações" : "Reduzir animações"}
    </button>
  );
}
