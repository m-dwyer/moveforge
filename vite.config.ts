import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import { resolve, sep } from "node:path";
import { spawn } from "node:child_process";

export default defineConfig({
  appType: "mpa",
  server: {
    port: 8765,
    strictPort: true,
    open: "/web/",
    fs: { strict: false },
    watch: {
      // .wasm changes are handled by the WASM rebuilder below, which fires a
      // custom HMR event the page listens for. Skip the default reload.
      ignored: ["**/web/wasm/**", "**/build/**", "**/dist/**", "**/dist-host/**", "**/renders/**"]
    }
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
  plugins: [react(), wasmRebuilder()]
});

function wasmRebuilder(): Plugin {
  const sourceRoot = resolve(import.meta.dirname, "src/modules");
  const sharedHostDir = resolve(import.meta.dirname, "src/host");
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
        const child = spawn("./scripts/build-wasm.sh", [], { env, stdio: "inherit" });
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
