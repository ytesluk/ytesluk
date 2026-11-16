"use client";

import { useEffect, useRef } from "react";

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * A card that leans toward the mouse, in perspective, with a soft light following the pointer.
 * Children marked with the `lift` class sit in front of the card's surface. Touch and
 * "reduce motion" leave it flat.
 */
export function Tilt({ children, className, max = 7 }: { children: React.ReactNode; className?: string; max?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || e.pointerType !== "mouse" || reduced()) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    el.style.setProperty("--ry", `${((x - 0.5) * 2 * max).toFixed(2)}deg`);
    el.style.setProperty("--rx", `${((0.5 - y) * 2 * max).toFixed(2)}deg`);
    el.style.setProperty("--gx", `${(x * 100).toFixed(1)}%`);
    el.style.setProperty("--gy", `${(y * 100).toFixed(1)}%`);
  };
  const leave = () => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--ry", "0deg");
    el.style.setProperty("--rx", "0deg");
  };
  return (
    <div ref={ref} onPointerMove={move} onPointerLeave={leave} className={`tilt ${className ?? ""}`}>
      {children}
    </div>
  );
}

/**
 * Scroll-linked stage: exposes `--p` (0 when the block enters the viewport from below, 1 once its
 * centre reaches the middle of the screen). The CSS turns that into a 3D rotation that settles.
 */
export function ScrollStage({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduced()) {
      el.style.setProperty("--p", "1");
      return;
    }
    let raf = 0;
    const update = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const t = clamp01((vh - r.top) / (vh / 2 + r.height / 2));
      el.style.setProperty("--p", (t * t * (3 - 2 * t)).toFixed(4));
    };
    const on = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => {
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return (
    <div ref={ref} className={`stage3d ${className ?? ""}`}>
      {children}
    </div>
  );
}

/**
 * Depth for the hero landscape: writes `--lp-scroll` (0–1 over the first screen) and `--lp-mx`
 * (pointer, -1 to 1) on the target element; each layer moves by its own distance.
 */
export function Parallax({ targetId }: { targetId: string }) {
  useEffect(() => {
    const el = document.getElementById(targetId);
    if (!el || reduced()) return;
    let raf = 0;
    let mx = 0;
    let shown = 0;
    const update = () => {
      raf = 0;
      el.style.setProperty("--lp-scroll", clamp01(window.scrollY / (window.innerHeight * 1.1)).toFixed(4));
      shown += (mx - shown) * 0.12;
      el.style.setProperty("--lp-mx", shown.toFixed(4));
      if (Math.abs(mx - shown) > 0.002) raf = requestAnimationFrame(update);
    };
    const on = () => {
      if (!raf && window.scrollY < window.innerHeight * 1.4) raf = requestAnimationFrame(update);
    };
    const onPointer = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      mx = (e.clientX / window.innerWidth) * 2 - 1;
      on();
    };
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("pointermove", onPointer, { passive: true });
    return () => {
      window.removeEventListener("scroll", on);
      window.removeEventListener("pointermove", onPointer);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [targetId]);
  return null;
}
