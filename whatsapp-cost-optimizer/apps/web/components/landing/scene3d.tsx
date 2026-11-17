"use client";

import { useEffect, useRef, useState } from "react";
import { calmMotion, useCalmMotion } from "./motion";
import { fontsReady } from "./three/fonts";
import { DESIGN_H, DESIGN_W, NARROW_QUERY } from "./three/frame";
import type { SceneHandle } from "./three/hero-scene";

type Kind = "hero" | "slips";
type Still = { src: string; width: number; height: number };
/** Stage proportion at which the camera stops framing by height and starts framing by width. */
const FIT = DESIGN_W / DESIGN_H;

const load = {
  hero: () => import("./three/hero-scene").then((m) => m.createHeroScene),
  slips: () => import("./three/slips-scene").then((m) => m.createSlipsScene),
};
// The hero is on the first screen: its code and fonts start downloading as soon as this script
// runs, not after the page has hydrated.
if (typeof window !== "undefined") {
  void load.hero().catch(() => undefined);
  void fontsReady();
}

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
 * (it is not part of the page's first load), a scene is only built when the visitor gets near it
 * and only renders while it is on screen, and visitors without WebGL get `fallback` instead.
 * Visitors who chose the calm version (see `motion.ts`) get a scene that only moves when they act
 * on it.
 *
 * `poster` holds still pictures of the scene's first frame, one for wide stages and one for phones
 * (see `scripts/hero-poster.mjs`). The right one is in the page from the first paint, laid out
 * exactly where the scene will draw, so the whole picture is there at once and comes alive when
 * the graphics card is ready.
 *
 * The canvas itself never takes pointer events (the page under its transparent parts stays
 * clickable): the pointer is followed on the window and handed to the scene, which says whether it
 * is over the machine. `focusId` names an element whose passage through the middle of the screen
 * drives the close-up.
 */
export function Scene3D({
  kind,
  className,
  fallback,
  label,
  hint,
  focusId,
  poster,
}: {
  kind: Kind;
  className?: string;
  fallback?: React.ReactNode;
  label?: string;
  hint?: string;
  focusId?: string;
  poster?: { wide: Still; narrow: Still };
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef<SceneHandle | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unsupported">("loading");
  const [covered, setCovered] = useState(false);
  const [touched, setTouched] = useState(false);
  const calm = useCalmMotion();

  // The still picture stays under the scene until the scene has fully faded in over it.
  useEffect(() => {
    if (state !== "ready") return;
    const t = window.setTimeout(() => setCovered(true), 600);
    return () => window.clearTimeout(t);
  }, [state]);

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
    const narrow = window.matchMedia(NARROW_QUERY).matches;
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
          const focus = 1 - t * t * (3 - 2 * t);
          handle.setFocus(focus);
          // The edge fade is only needed (and only paid for) while the statement fills the stage.
          el.classList.toggle("is-close", focus > 0.01);
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

    const start = async () => {
      try {
        // Building the scene keeps the graphics card and this thread busy: let the still picture
        // reach the screen first, so the visitor is never looking at an empty stage.
        const img = Array.from(el.parentElement?.querySelectorAll<HTMLImageElement>(".scene-poster") ?? []).find((i) => getComputedStyle(i).display !== "none");
        if (img) {
          await img.decode().catch(() => undefined);
          await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
        }
        const create = await load[kind]();
        if (cancelled) return;
        const h = await create(el, { calm: calmMotion(), small, narrow });
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
    };
    // A scene far down the page is not built (and costs the graphics card nothing) until the visitor gets near it.
    const near = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        near.disconnect();
        void start();
      },
      { rootMargin: "1000px 0px" },
    );
    near.observe(el);

    return () => {
      cancelled = true;
      near.disconnect();
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
      {poster && !covered ? (
        // The picture the scene opens with, sized by the same rule as the camera: the wide one fills
        // the height (or the design width when the stage is too narrow), the phone one the width.
        <>
          <img src={poster.wide.src} alt="" aria-hidden draggable={false} fetchPriority="high" className="scene-poster scene-poster-wide" style={{ width: `${(poster.wide.width / poster.wide.height / FIT) * 100}%` }} />
          <img src={poster.narrow.src} alt="" aria-hidden draggable={false} fetchPriority="high" className="scene-poster scene-poster-narrow" style={{ height: `${(FIT / (poster.narrow.width / poster.narrow.height)) * 100}%` }} />
        </>
      ) : null}
      <canvas ref={canvas} role="img" aria-label={label} className={className} style={{ opacity: state === "ready" ? 1 : 0, transition: "opacity 400ms ease" }} />
      {hint && state === "ready" ? (
        <p className="scene-hint" style={{ opacity: touched ? 0 : 1 }} aria-hidden>
          {hint}
        </p>
      ) : null}
    </>
  );
}
