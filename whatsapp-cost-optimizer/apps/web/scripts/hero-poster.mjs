// Renders the still picture of the printer that the product page shows until the 3D scene is ready
// (components/landing/hero-poster.webp). It is the scene's own first frame, so run this again
// whenever the printer, the lights or the camera of the hero scene change:
//
//   pnpm --filter @wco/web dev            (in another terminal)
//   node apps/web/scripts/hero-poster.mjs http://localhost:3000
//
// Set PLAYWRIGHT_CHROMIUM_PATH if Playwright's own browser is not installed.
import { writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const out = new URL("../components/landing/hero-poster.webp", import.meta.url);

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  // Software rendering, so the picture is the same whatever machine runs this.
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
});
try {
  // A wide, tall stage: the camera frames by height there, which is the size the page lays the picture out by.
  const context = await browser.newContext({ viewport: { width: 1800, height: 900 }, deviceScaleFactor: 1.5 });
  const page = await context.newPage();
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    // The canvas can only be read back in the same task that drew it: look right after every frame.
    window.requestAnimationFrame = (cb) =>
      raf((t) => {
        cb(t);
        if (window.__poster) return;
        const canvas = document.querySelector(".hero-stage canvas");
        if (!canvas || canvas.width < 600) return;
        const url = canvas.toDataURL("image/webp", 0.9);
        if (url.length > 20000) window.__poster = { url, width: canvas.width, height: canvas.height };
      });
  });
  await page.goto(`${base}/inicio`);
  const handle = await page.waitForFunction(() => window.__poster, null, { timeout: 180000 });
  const shot = await handle.jsonValue();
  const bytes = Buffer.from(shot.url.split(",")[1], "base64");
  await writeFile(out, bytes);
  process.stdout.write(`hero-poster.webp: ${shot.width}×${shot.height}, ${(bytes.length / 1024).toFixed(0)} KB\n`);
} finally {
  await browser.close();
}
