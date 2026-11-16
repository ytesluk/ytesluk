"use client";

import { useEffect, useRef, useState } from "react";
import { calmMotion, setFullMotion, useCalmMotion, useSystemReducesMotion } from "./motion";
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

const INTERACTIVE = "a,button,input,textarea,select,summary,label,[role=tab]";
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Mounts one of the WebGL scenes on a canvas that fills its parent. three.js is loaded on demand
 * (it is not part of the page's first load), the scene only renders while it is on screen, and
 * visitors without WebGL get `fallback` instead. On a system set to reduce motion the scene runs
 * in its calm version, and the hint offers to turn every animation on (see `motion.ts`).
 *
 * The canvas itself never takes pointer events (the page under its transparent parts stays
 * clickable): the pointer is followed on the window and handed to the scene, which says whether it
 * is over the machine. `focusId` names an element whose passage through the middle of the screen
 * drives the close-up.
 */
export function Scene3D({ kind, className, fallback, label, hint, focusId }: { kind: Kind; className?: string; fallback?: React.ReactNode; label?: string; hint?: string; focusId?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef<SceneHandle | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unsupported">("loading");
  const [touched, setTouched] = useState(false);
  const calm = useCalmMotion();
  const systemReduces = useSystemReducesMotion();

  useEffect(() => {
    live.current?.setCalm(calm);
  }, [calm]);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    if (!webglAvailable()) {
      setState("unsupported");
      return;
    }
    let handle: SceneHandle | null = null;
    let cancelled = false;
    let dragging = false;
    let grabbing = false;
    let travel = 0;
    let lastX = 0;
    let lastY = 0;
    const small = window.matchMedia("(max-width: 767px)").matches;
    const root = document.documentElement;

    /** Pointer in the canvas's own frame: -1..1 on each axis, y up; beyond that outside it. */
    const local = (e: PointerEvent): [number, number] => {
      const r = el.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)];
    };
    const onMove = (e: PointerEvent) => {
      if (!handle) return;
      const [x, y] = local(e);
      if (dragging) {
        travel += Math.hypot(e.clientX - lastX, e.clientY - lastY);
        lastX = e.clientX;
        lastY = e.clientY;
      }
      const over = handle.pointerMove(x, y);
      // Only touch the cursor when this scene's own answer changes (other scenes listen too).
      const grab = e.pointerType === "mouse" && !dragging && over && !(e.target as Element | null)?.closest?.(INTERACTIVE);
      if (grab !== grabbing) {
        grabbing = grab;
        if (!dragging) root.style.cursor = grab ? "grab" : "";
      }
    };
    const onDown = (e: PointerEvent) => {
      if (!handle || e.button !== 0 || (e.target as Element | null)?.closest?.(INTERACTIVE)) return;
      const [x, y] = local(e);
      if (!handle.pointerDown(x, y)) return;
      dragging = true;
      travel = 0;
      lastX = e.clientX;
      lastY = e.clientY;
      setTouched(true);
      if (e.pointerType === "mouse") {
        e.preventDefault(); // no text selection while turning the machine
        root.style.cursor = "grabbing";
      }
    };
    const onUp = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      handle?.pointerUp(e.type === "pointerup" && travel < 6);
      root.style.cursor = grabbing ? "grab" : "";
    };
    const onScroll = () => {
      if (!handle) return;
      if (kind === "hero") {
        // 0 at the top of the page, 1 once the page has scrolled one viewport.
        handle.setScroll(clamp01(window.scrollY / window.innerHeight));
        if (window.scrollY > 140) setTouched(true); // the hint has done its job once the page moves on
        const beat = focusId ? document.getElementById(focusId) : null;
        const r = beat?.getBoundingClientRect();
        if (r && r.height > 0) {
          // 1 while the block is around the middle of the screen, 0 when it is at an edge.
          const d = Math.abs(r.top + r.height / 2 - window.innerHeight / 2) / (window.innerHeight / 2);
          const t = clamp01((d - 0.16) / 0.84);
          handle.setFocus(1 - t * t * (3 - 2 * t));
        } else handle.setFocus(0);
      } else {
        // 0 when the canvas enters the viewport from below, 1 when it leaves at the top.
        const r = el.getBoundingClientRect();
        handle.setScroll(clamp01((window.innerHeight - r.top) / (window.innerHeight + r.height)));
      }
    };
    const io = new IntersectionObserver(([e]) => handle?.setActive(!!e?.isIntersecting), { rootMargin: "120px" });
    const ro = new ResizeObserver(() => {
      handle?.resize();
      onScroll();
    });

    (async () => {
      try {
        const h =
          kind === "hero"
            ? await (await import("./three/hero-scene")).createHeroScene(el, { calm: calmMotion(), small })
            : await (await import("./three/slips-scene")).createSlipsScene(el, { calm: calmMotion(), small });
        if (cancelled) {
          h.dispose();
          return;
        }
        handle = h;
        live.current = h;
        h.setCalm(calmMotion()); // the choice may have changed while the scene was loading
        io.observe(el);
        ro.observe(el);
        window.addEventListener("pointermove", onMove, { passive: true });
        window.addEventListener("pointerdown", onDown);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
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
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("scroll", onScroll);
      root.style.cursor = "";
      live.current = null;
      handle?.dispose();
    };
  }, [kind, focusId]);

  if (state === "unsupported") return <>{fallback ?? null}</>;
  return (
    <>
      <canvas ref={canvas} role="img" aria-label={label} className={className} style={{ opacity: state === "ready" ? 1 : 0, transition: "opacity 500ms ease" }} />
      {hint && state === "ready" ? (
        <div className="scene-notes">
          <p className="scene-hint" style={{ opacity: touched ? 0 : 1 }} aria-hidden>
            {hint}
          </p>
          {systemReduces ? (
            <p className="scene-motion">
              {calm ? "Animações reduzidas pelo seu sistema" : "Todas as animações ligadas"}
              <button type="button" onClick={() => setFullMotion(calm)}>
                {calm ? "Ligar todas" : "Reduzir"}
              </button>
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
