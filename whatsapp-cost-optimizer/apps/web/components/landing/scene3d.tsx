"use client";

import { useEffect, useRef, useState } from "react";
import type { SceneHandle } from "./three/hero-scene";

type Kind = "hero" | "slips";

function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

/**
 * Mounts one of the WebGL scenes on a canvas that fills its parent. three.js is loaded on demand
 * (it is not part of the page's first load), the scene only renders while it is on screen, and
 * visitors without WebGL get `fallback` instead. With "reduce motion" the scene is a still image.
 */
export function Scene3D({ kind, className, fallback, label }: { kind: Kind; className?: string; fallback?: React.ReactNode; label?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "unsupported">("loading");

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    if (!webglAvailable()) {
      setState("unsupported");
      return;
    }
    let handle: SceneHandle | null = null;
    let cancelled = false;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const onPointer = (e: PointerEvent) => handle?.setPointer((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
    const onScroll = () => {
      if (kind === "hero") {
        // 0 at the top of the page, 1 once the page has scrolled one viewport.
        handle?.setScroll(Math.min(1, Math.max(0, window.scrollY / window.innerHeight)));
      } else {
        // 0 when the canvas enters the viewport from below, 1 when it leaves at the top.
        const r = el.getBoundingClientRect();
        handle?.setScroll(Math.min(1, Math.max(0, (window.innerHeight - r.top) / (window.innerHeight + r.height))));
      }
    };
    const io = new IntersectionObserver(([e]) => handle?.setActive(!!e?.isIntersecting), { rootMargin: "120px" });
    const ro = new ResizeObserver(() => handle?.resize());

    (async () => {
      try {
        const mod = kind === "hero" ? await import("./three/hero-scene") : await import("./three/slips-scene");
        const h = kind === "hero" ? await (mod as typeof import("./three/hero-scene")).createHeroScene(el, { reducedMotion }) : await (mod as typeof import("./three/slips-scene")).createSlipsScene(el, { reducedMotion });
        if (cancelled) {
          h.dispose();
          return;
        }
        handle = h;
        io.observe(el);
        ro.observe(el);
        if (!reducedMotion) window.addEventListener("pointermove", onPointer, { passive: true });
        window.addEventListener("scroll", onScroll, { passive: true });
        onScroll();
        setState("ready");
      } catch {
        if (!cancelled) setState("unsupported");
      }
    })();

    return () => {
      cancelled = true;
      io.disconnect();
      ro.disconnect();
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("scroll", onScroll);
      handle?.dispose();
    };
  }, [kind]);

  if (state === "unsupported") return <>{fallback ?? null}</>;
  return <canvas ref={canvas} role="img" aria-label={label} className={className} style={{ opacity: state === "ready" ? 1 : 0, transition: "opacity 500ms ease" }} />;
}
