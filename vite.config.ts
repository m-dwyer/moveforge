import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  appType: "mpa",
  server: {
    port: 8765,
    strictPort: true,
    open: "/web/",
    fs: { strict: false }
  },
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "web/src")
    }
  },
  build: {
    outDir: "web/dist",
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      input: resolve(import.meta.dirname, "web/index.html")
    }
  },
  plugins: [react()]
});
