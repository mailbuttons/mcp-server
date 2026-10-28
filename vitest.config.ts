import { defineConfig } from "vitest/config";

// Tests import the compiled output under `dist/` (the `test` script runs
// `npm run build` first), which keeps vitest off the NodeNext `.js`-import
// resolution path and exercises exactly what gets published.
export default defineConfig({
  // Inline (empty) PostCSS config so vitest does NOT walk up the tree and load
  // the repo-root postcss.config.js (which needs tailwindcss — a root dep not
  // installed when this package is built in isolation in CI). This package has
  // no CSS.
  css: { postcss: { plugins: [] } },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
