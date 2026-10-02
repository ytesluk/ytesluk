import { defineConfig } from "tsup";

// Workspace packages ship TypeScript sources and are bundled; npm dependencies stay external.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  noExternal: [/^@wco\//],
});
