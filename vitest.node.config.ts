import { defineConfig } from "vitest/config";

// Node-environment tests that run without the device or a browser. Kept
// separate from vite.config.ts (which is browser-mode, rooted at web/).
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node"
  }
});
