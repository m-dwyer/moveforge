#!/usr/bin/env node
import { startStaticServer } from "./lib/static-server.ts";

const port = Number(process.env.PORT ?? 8765);
const server = await startStaticServer({ port });

console.log(`Serving ${server.origin}/web/`);

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

async function shutdown(): Promise<void> {
  await server.close();
  process.exit(0);
}
