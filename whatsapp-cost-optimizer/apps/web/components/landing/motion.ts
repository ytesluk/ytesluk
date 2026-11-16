"use client";

import { useSyncExternalStore } from "react";

/**
 * How much the product page moves.
 *
 * A system set to "reduce motion" (on Windows: animation effects turned off, which many people do
 * only to make an old computer faster) gets the calm version: nothing moves on its own and nothing
 * follows the mouse, but everything the visitor does on purpose still answers: dragging the
 * printer, clicking it, scrolling. From there the visitor can turn every animation on for this
 * site, and back off again. The choice is kept in this browser.
 */
const KEY = "wco-motion";
const QUERY = "(prefers-reduced-motion: reduce)";
const listeners = new Set<() => void>();

function optedIn(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "full";
  } catch {
    return false;
  }
}

/** The system asks for less motion. */
export function systemReducesMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia(QUERY).matches;
}

/** The calm version is in effect: the system asks for less motion and the visitor has not chosen otherwise. */
export function calmMotion(): boolean {
  return systemReducesMotion() && !optedIn();
}

function mark() {
  // Lets the stylesheet play its own short animations once the visitor has asked for all of them.
  if (systemReducesMotion() && optedIn()) document.documentElement.dataset.motion = "full";
  else delete document.documentElement.dataset.motion;
}

/** The visitor's own choice, on top of what the system says. */
export function setFullMotion(on: boolean) {
  try {
    if (on) window.localStorage.setItem(KEY, "full");
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
