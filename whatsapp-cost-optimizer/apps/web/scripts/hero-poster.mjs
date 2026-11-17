// Renders the still pictures the product page shows until the 3D scene is ready
// (components/landing/hero-poster.webp and hero-poster-narrow.webp). They are the scene's own
// first frame, so run this again whenever the printer, the statement, the outlines around it, the
// lights or the camera of the hero scene change:
//
//   pnpm --filter @wco/web dev            (in another terminal)
//   node apps/web/scripts/hero-poster.mjs http://localhost:3000
//
// Set PLAYWRIGHT_CHROMIUM_PATH if Playwright's own browser is not installed.
import { writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const shots = [
  // A wide, tall stage: the camera frames by height there, which is the size the page lays the picture out by.
  { file: "hero-poster.webp", viewport: { width: 1800, height: 900 }, deviceScaleFactor: 1.5 },
  // A phone held upright (tall enough here to show the whole stage without scrolling): the camera
  // frames by width, and the outlines stack down the left.
  { file: "hero-poster-narrow.webp", viewport: { width: 390, height: 1700 }, deviceScaleFactor: 3 },
];

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  // Software rendering, so the picture is the same whatever machine runs this.
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
});
try {
  for (const shot of shots) {
    const context = await browser.newContext({ viewport: shot.viewport, deviceScaleFactor: shot.deviceScaleFactor });
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
    const got = await handle.jsonValue();
    const bytes = Buffer.from(got.url.split(",")[1], "base64");
    await writeFile(new URL(`../components/landing/${shot.file}`, import.meta.url), bytes);
    process.stdout.write(`${shot.file}: ${got.width}×${got.height}, ${(bytes.length / 1024).toFixed(0)} KB\n`);
    await context.close();
  }
} finally {
  await browser.close();
}
