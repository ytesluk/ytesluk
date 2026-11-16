"use client";

import { useSyncExternalStore } from "react";

/**
 * How much the product page moves.
 *
 * Everyone gets every animation, including visitors whose system is set to "reduce motion" (on
 * Windows that is "animation effects" turned off, which many people do only to make an old
 * computer faster): the 3D scenes are the product's shop window. Those visitors do get a discreet
 * "Reduzir animações" switch in the footer. It turns on the calm version, where nothing moves on
 * its own and nothing follows the mouse, but everything done on purpose still answers: dragging
 * the printer, clicking it, scrolling. The choice is kept in this browser.
 */
const KEY = "wco-motion";
const QUERY = "(prefers-reduced-motion: reduce)";
const listeners = new Set<() => void>();

/** The system asks for less motion. */
export function systemReducesMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia(QUERY).matches;
}

/** The calm version is in effect: the visitor asked for it on this site. */
export function calmMotion(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(KEY) === "calm";
  } catch {
    return false;
  }
}

function mark() {
  // Lets the stylesheet play its animations on a system that asks for less motion.
  if (systemReducesMotion() && !calmMotion()) document.documentElement.dataset.motion = "full";
  else delete document.documentElement.dataset.motion;
}

/** The visitor's own choice. */
export function setCalmMotion(on: boolean) {
  try {
    if (on) window.localStorage.setItem(KEY, "calm");
    else window.localStorage.removeItem(KEY);
  } catch {
    // Storage is blocked: the choice cannot be kept, so there is nothing to switch.
    return;
  }
  mark();
  for (const l of listeners) l();
}

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(QUERY);
  const changed = () => {
    mark();
    onChange();
  };
  listeners.add(onChange);
  mq.addEventListener("change", changed);
  mark();
  return () => {
    listeners.delete(onChange);
    mq.removeEventListener("change", changed);
  };
}

export function useCalmMotion(): boolean {
  return useSyncExternalStore(subscribe, calmMotion, () => false);
}

export function useSystemReducesMotion(): boolean {
  return useSyncExternalStore(subscribe, systemReducesMotion, () => false);
}
