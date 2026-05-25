#!/usr/bin/env node
import { spawn } from "node:child_process";
import { watch, type FSWatcher } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { listModuleIds } from "./lib/modules.ts";
import { startStaticServer, type StaticServer } from "./lib/static-server.ts";

const port = Number(process.env.PORT ?? 8765);
const rebuildDebounceMs = Number(process.env.REBUILD_DEBOUNCE_MS ?? 200);
const explicitModuleId = process.env.MODULE_ID;
const moduleIds = explicitModuleId ? [explicitModuleId] : await listModuleIds();
const watchedRoots = [explicitModuleId ? `src/modules/${explicitModuleId}` : "src/modules", "web"];
const ignoredPathParts = new Set(["dist", "wasm"]);

let server: StaticServer | null = null;
let rebuilding = false;
let rebuildAgain = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const watchers: FSWatcher[] = [];
const watchedDirs = new Set<string>();

await buildWeb();
await buildWasm();
server = await startStaticServer({ port });

console.log(`Serving ${server.origin}/web/`);
console.log(`Watching ${watchedRoots.join(", ")} for changes`);

for (const root of watchedRoots) await watchTree(root);

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

async function buildWasm(): Promise<void> {
  const env: Record<string, string> = explicitModuleId ? { MODULE_ID: explicitModuleId } : {};
  await run("./scripts/build-wasm.sh", [], env);
}

async function buildWeb(): Promise<void> {
  await run(process.execPath, [resolve("node_modules/typescript/bin/tsc"), "-p", "web/tsconfig.json"], {});
}

async function watchTree(root: string): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  await watchDir(root);
  for (const entry of entries) {
    if (entry.isDirectory() && !ignoredPathParts.has(entry.name)) {
      await watchTree(join(root, entry.name));
    }
  }
}

async function watchDir(dir: string): Promise<void> {
  if (watchedDirs.has(dir)) return;
  watchedDirs.add(dir);
  const watcher = watch(dir, { persistent: true }, (_event, filename) => {
    const file = filename ? join(dir, filename.toString()) : dir;
    const nameParts = file.split(/[\\/]/);
    if (nameParts.some((part) => ignoredPathParts.has(part))) return;
    scheduleRebuild(file);
    void watchNewParent(file);
  });
  watchers.push(watcher);
}

async function watchNewParent(path: string): Promise<void> {
  const parent = dirname(path);
  if (!watchedDirs.has(parent)) await watchTree(parent);
  await watchTree(path).catch(() => {});
}

function scheduleRebuild(path: string): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => void rebuild(path), Math.max(50, rebuildDebounceMs));
}

async function rebuild(path: string): Promise<void> {
  if (rebuilding) {
    rebuildAgain = true;
    return;
  }
  rebuilding = true;
  const shouldBuildWeb = path.split(/[\\/]/).includes("src") && path.split(/[\\/]/).includes("web");
  const shouldBuildWasm = explicitModuleId ? path.startsWith(`src/modules/${explicitModuleId}`) : path.startsWith("src/modules/");
  if (!shouldBuildWeb && !shouldBuildWasm) {
    console.log(`Change detected in ${path}; reload the browser tab.`);
    rebuilding = false;
    return;
  }
  console.log(`Change detected in ${path}; rebuilding ${shouldBuildWeb && shouldBuildWasm ? "web and WASM" : shouldBuildWeb ? "web" : "WASM"}...`);
  try {
    if (shouldBuildWeb) await buildWeb();
    if (shouldBuildWasm) await buildWasm();
    console.log("Rebuild complete. Reload the browser tab.");
  } catch (error) {
    console.error(`WASM rebuild failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    rebuilding = false;
    if (rebuildAgain) {
      rebuildAgain = false;
      await rebuild("queued changes");
    }
  }
}

function run(command: string, args: string[], env: Record<string, string>): Promise<void> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: "inherit"
    });
    child.on("error", rejectRun);
    child.on("exit", (code, signal) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${command} exited with ${signal ?? code}`));
    });
  });
}

async function shutdown(): Promise<void> {
  for (const watcher of watchers) watcher.close();
  await server?.close();
  process.exit(0);
}
