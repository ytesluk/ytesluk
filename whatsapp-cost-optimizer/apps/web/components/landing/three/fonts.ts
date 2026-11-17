/** Faces the 3D scenes draw into their textures. No three.js here: the page can start loading them early. */
export const FONT = {
  display: '"Bricolage Grotesque Variable", system-ui, sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, monospace',
};

/** Web fonts must be ready before text is drawn into a texture (otherwise the fallback face is baked in). */
export async function fontsReady(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  await Promise.all([
    document.fonts.load(`700 32px ${FONT.display}`),
    document.fonts.load(`500 20px ${FONT.mono}`),
    document.fonts.load(`600 20px ${FONT.mono}`),
  ]).catch(() => undefined);
}
