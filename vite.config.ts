import { defineConfig } from "vitest/config";
import type { Plugin, ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

const REPO_ROOT = import.meta.dirname;

export default defineConfig(({ mode }) => {
  const isTest = mode === "test";
  return {
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
    plugins: [react(), serveRepoModules(), ...(isTest ? [] : [wasmRebuilder()])],
    test: {
      include: ["tests/**/*.spec.ts"],
      browser: {
        enabled: true,
        headless: true,
        provider: playwright(),
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
