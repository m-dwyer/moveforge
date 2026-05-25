import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import { extname, join, relative, resolve, sep } from "node:path";

export type StaticServer = {
  close: () => Promise<void>;
  origin: string;
  port: number;
  server: Server;
};

type StaticServerOptions = {
  host?: string;
  port: number;
  root?: string;
};

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".wav": "audio/wav"
};

export async function startStaticServer(options: StaticServerOptions): Promise<StaticServer> {
  const host = options.host ?? "127.0.0.1";
  const root = resolve(options.root ?? process.cwd());
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? host}`);
      const path = await resolveRequestPath(root, url.pathname);
      if (!path) return sendText(response, 403, "Forbidden\n");

      const info = await stat(path).catch(() => null);
      if (!info) return sendText(response, 404, "Not found\n");

      const file = info.isDirectory() ? join(path, "index.html") : path;
      const fileInfo = await stat(file).catch(() => null);
      if (!fileInfo?.isFile()) return sendText(response, 404, "Not found\n");

      response.writeHead(200, {
        "cache-control": "no-store",
        "content-length": fileInfo.size,
        "content-type": MIME_TYPES[extname(file)] ?? "application/octet-stream"
      });
      createReadStream(file).pipe(response);
    } catch (error) {
      sendText(response, 500, `${error instanceof Error ? error.message : String(error)}\n`);
    }
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(options.port, host, () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port;
  return {
    close: () => new Promise((resolveClose) => server.close(() => resolveClose())),
    origin: `http://${host}:${port}`,
    port,
    server
  };
}

async function resolveRequestPath(root: string, requestPath: string): Promise<string | null> {
  const decoded = decodeURIComponent(requestPath);
  const joined = resolve(root, `.${decoded}`);
  const rel = relative(root, joined);
  if (rel === "" || (!rel.startsWith("..") && !rel.includes(`..${sep}`))) return joined;
  return null;
}

function sendText(response: ServerResponse, status: number, body: string): void {
  if (response.headersSent) {
    response.end();
    return;
  }
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-type": "text/plain; charset=utf-8"
  });
  response.end(body);
}
