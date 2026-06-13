import { defineConfig } from "vitest/config";
import type { Plugin, ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { join, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { copyFile, mkdir, readdir, readFile } from "node:fs/promises";

const REPO_ROOT = import.meta.dirname;

export default defineConfig(({ mode, command }) => {
  const isTest = mode === "test";
  const isBuild = command === "build";
  // Project Pages site is served under https://<user>.github.io/<repo>/, so the
  // built app must resolve assets under that subpath. Dev/test stay at root.
  // Override with PAGES_BASE (e.g. "/" for a user page or custom domain).
  const base = isBuild ? process.env.PAGES_BASE ?? "/moveforge/" : "/";
  return {
    base,
    root: "web",
    server: {
      port: 8765,
      strictPort: true,
      open: "/",
      watch: {
        // .wasm changes are handled by the WASM rebuilder below, which fires a
        // custom HMR event the page listens for. Skip the default reload.
        ignored: ["**/wasm/**", "**/dist/**"]
      }
    },
    resolve: {
      alias: [
        ...(isTest
          ? [{ find: "@/audio", replacement: resolve(REPO_ROOT, "web/tests/mocks/audio.ts") }]
          : []),
        { find: "@", replacement: resolve(REPO_ROOT, "web/src") }
      ]
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      target: "es2022"
    },
    optimizeDeps: {
      include: ["zustand/middleware"]
    },
    plugins: [
      react(),
      serveRepoModules(),
      copyStaticAssets(),
      ...(isTest ? [] : [wasmRebuilder()])
    ],
    test: {
      include: ["tests/**/*.spec.ts"],
      browser: {
        enabled: true,
        headless: true,
        provider: playwright(),
        // Vitest's built-in browser viewport default is mobile-sized (414px). This app's
        // sensible default is desktop, so pin tests above the lg: breakpoint (1024px).
        // Mobile-path tests opt in explicitly via page.viewport(...).
        viewport: { width: 1280, height: 800 },
        instances: [{ browser: "chromium" }]
      }
    }
  };
});

// Expose src/modules/<id>/{module,presets,metadata}.json + src/modules/index.json at
// /modules/* — those files live outside the Vite root (web/), so they need
// an explicit URL mapping rather than Vite's filesystem fallthrough.
function serveRepoModules(): Plugin {
  const sourceDir = resolve(REPO_ROOT, "src/modules");
  const allowedPrefix = sourceDir + sep;
  return {
    name: "moveforge-serve-repo-modules",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url) return next();
        const match = req.url.split("?")[0].match(/^\/modules\/(.+)$/);
        if (!match) return next();
        const filePath = resolve(sourceDir, match[1]);
        if (!filePath.startsWith(allowedPrefix) && filePath !== sourceDir) {
          res.statusCode = 403;
          res.end("forbidden");
          return;
        }
        try {
          const data = await readFile(filePath);
          res.setHeader("Content-Type", contentTypeFor(filePath));
          res.end(data);
        } catch {
          res.statusCode = 404;
          res.end("not found");
        }
      });
    }
  };
}

// The dev-only serveRepoModules/wasmRebuilder plugins fake a backend during
// `vite dev`. For a static deploy (GitHub Pages) the production build must
// instead emit those files as real assets: the compiled WASM, the repo module
// JSON, and the AudioWorklet processor — all fetched at runtime by absolute
// (base-relative) URL, so Vite's bundler never sees them otherwise.
function copyStaticAssets(): Plugin {
  let outDir = resolve(REPO_ROOT, "web/dist");
  return {
    name: "moveforge-copy-static-assets",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      // AudioWorklet processor (loaded via audioWorklet.addModule).
      await copyFile(resolve(REPO_ROOT, "web/module-worklet.js"), join(outDir, "module-worklet.js"));

      // Compiled WASM modules. Built by scripts/build-wasm.sh before `vite build`.
      const wasmSrc = resolve(REPO_ROOT, "web/wasm");
      const wasmOut = join(outDir, "wasm");
      await mkdir(wasmOut, { recursive: true });
      let wasmCount = 0;
      try {
        for (const entry of await readdir(wasmSrc, { withFileTypes: true })) {
          if (!entry.isFile() || !entry.name.endsWith(".wasm")) continue;
          await copyFile(join(wasmSrc, entry.name), join(wasmOut, entry.name));
          wasmCount += 1;
        }
      } catch (err) {
        this.warn(`no WASM found under web/wasm (${(err as Error).message}); run build-wasm.sh first`);
      }
      if (wasmCount === 0) this.warn("copied 0 .wasm files — the deployed app will show no modules");

      // Repo module metadata, mirroring what serveRepoModules exposes in dev:
      // index.json plus each module's module/presets/metadata JSON.
      const modulesSrc = resolve(REPO_ROOT, "src/modules");
      const modulesOut = join(outDir, "modules");
      await mkdir(modulesOut, { recursive: true });
      await copyFile(join(modulesSrc, "index.json"), join(modulesOut, "index.json"));
      for (const entry of await readdir(modulesSrc, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
        const srcDir = join(modulesSrc, entry.name);
        const dstDir = join(modulesOut, entry.name);
        await mkdir(dstDir, { recursive: true });
        for (const file of ["module.json", "presets.json", "metadata.json"]) {
          await copyFile(join(srcDir, file), join(dstDir, file)).catch(() => {});
        }
      }
    }
  };
}

function contentTypeFor(path: string): string {
  const ext = path.split(".").pop() ?? "";
  if (ext === "json") return "application/json";
  if (ext === "wasm") return "application/wasm";
  if (ext === "js") return "text/javascript";
  return "application/octet-stream";
}

function wasmRebuilder(): Plugin {
  const sourceRoot = resolve(REPO_ROOT, "src/modules");
  const sharedHostDir = resolve(REPO_ROOT, "src/host");
  let busy = false;
  const queued = new Set<string | null>(); // null = rebuild all
  let server: ViteDevServer;

  return {
    name: "moveforge-wasm-rebuilder",
    apply: "serve",
    configureServer(s) {
      server = s;
      server.watcher.add([sourceRoot, sharedHostDir]);
      server.watcher.on("change", (file) => onChange(file));
      server.watcher.on("add", (file) => onChange(file));
    }
  };

  function onChange(file: string): void {
    if (file.startsWith(sharedHostDir)) {
      // A shared host header changed; rebuild everything.
      enqueue(null);
      return;
    }
    const prefix = sourceRoot + sep;
    if (!file.startsWith(prefix)) return;
    const moduleId = file.slice(prefix.length).split(sep)[0];
    if (!moduleId || moduleId.startsWith("_")) return;
    enqueue(moduleId);
  }

  function enqueue(moduleId: string | null): void {
    queued.add(moduleId);
    if (!busy) void drain();
  }

  async function drain(): Promise<void> {
    busy = true;
    try {
      while (queued.size > 0) {
        const next = queued.values().next().value;
        queued.delete(next ?? null);
        await rebuild(next ?? null);
      }
    } finally {
      busy = false;
    }
  }

  async function rebuild(moduleId: string | null): Promise<void> {
    const label = moduleId ?? "all modules";
    server.config.logger.info(`[wasm] rebuilding ${label}...`);
    const env = { ...process.env, ...(moduleId ? { MODULE_ID: moduleId } : {}) };
    try {
      await new Promise<void>((res, rej) => {
        const child = spawn("./scripts/build-wasm.sh", [], { env, stdio: "inherit", cwd: REPO_ROOT });
        child.on("exit", (code) => (code === 0 ? res() : rej(new Error(`exit ${code}`))));
        child.on("error", rej);
      });
      server.config.logger.info(`[wasm] ${label} rebuilt`);
      server.ws.send({ type: "custom", event: "moveforge:wasm-rebuilt", data: { moduleId } });
    } catch (err) {
      server.config.logger.error(`[wasm] ${label} rebuild failed: ${(err as Error).message}`);
    }
  }
}
