/**
 * How much the 3D scenes may ask of this device. No three.js here.
 *
 * "lite" is for browsers that draw WebGL on the processor instead of a graphics card (hardware
 * acceleration turned off, an old or blocked driver, a remote desktop). There every pixel is paid
 * for in CPU time, so the scenes drop what costs most per pixel (smoothing, shadows, reflections of
 * the studio) from the first frame, instead of stuttering first and losing quality in front of the
 * visitor. A graphics card that turned out too slow for "full" is remembered and opens in "lite"
 * next time. "none" means there is no WebGL at all.
 *
 * The tier is worked out once, before the page first paints, by `tierScript` (inlined in the page):
 * it has to be known that early because the still picture shown while a scene loads is drawn in the
 * same tier. The answer is kept in this browser, so later visits do not look again.
 *
 * `?render=full` or `?render=lite` in the address forces one (used to render the still pictures).
 */
export type RenderTier = "full" | "lite" | "none";

const GPU_KEY = "wco-gpu";
const SLOW_KEY = "wco-render";
/** Names under which browsers report drawing on the processor. */
const SOFTWARE = "swiftshader|llvmpipe|softpipe|software|basic render|warp";

/**
 * Sets `data-render` on <html> and starts downloading the one still picture that will show (wide or
 * phone, in this tier), ahead of everything else. Plain ES5, self-contained: it runs inline, before
 * anything below it on the page is painted.
 */
export function tierScript(stills: Record<"full" | "lite", { wide: string; narrow: string }>, narrowQuery: string): string {
  return `(function(){var t;try{var s=window.localStorage,q=/[?&]render=(full|lite)(&|$)/.exec(location.search);t=q?q[1]:s.getItem("${SLOW_KEY}")==="lite"?"lite":s.getItem("${GPU_KEY}");if(!t){var c=document.createElement("canvas"),g=c.getContext("webgl2")||c.getContext("webgl");if(!g)t="none";else{var i=g.getExtension("WEBGL_debug_renderer_info"),n=String(i?g.getParameter(i.UNMASKED_RENDERER_WEBGL):g.getParameter(g.RENDERER));t=/${SOFTWARE}/i.test(n)?"lite":"full";var l=g.getExtension("WEBGL_lose_context");if(l)l.loseContext()}try{s.setItem("${GPU_KEY}",t)}catch(e){}}}catch(e){t=t||"full"}document.documentElement.setAttribute("data-render",t);var p=${JSON.stringify(stills)}[t];if(p){var k=document.createElement("link");k.rel="preload";k.as="image";k.setAttribute("fetchpriority","high");k.href=window.matchMedia(${JSON.stringify(narrowQuery)}).matches?p.narrow:p.wide;document.head.appendChild(k)}})();`;
}

export function renderTier(): RenderTier {
  const t = document.documentElement.dataset.render;
  return t === "lite" || t === "none" ? t : "full";
}

/**
 * Checks the tier against the context a scene really got, and corrects what is remembered for the
 * next visit (the visitor may have turned hardware acceleration on or off since the first one).
 */
export function noteRenderer(gl: WebGLRenderingContext | WebGL2RenderingContext) {
  try {
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    window.localStorage.setItem(GPU_KEY, new RegExp(SOFTWARE, "i").test(name) ? "lite" : "full");
  } catch {
    // Nothing to remember it in.
  }
}

/** Called when the full scene could not hold a smooth frame rate here. */
export function rememberSlowDevice() {
  try {
    window.localStorage.setItem(SLOW_KEY, "lite");
  } catch {
    // Nothing to remember it in: it will be found out again next time.
  }
}
