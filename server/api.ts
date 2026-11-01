// HTTP only. The app is a static bundle: every formula runs in core/, which
// the UI imports directly, so the server has exactly two jobs -- prove it is
// ours (/api/whoami, for the launcher's reuse check) and serve ui/dist.

import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { C } from "../core/constants.ts";

const ROOT = resolve(import.meta.dirname, "..");
const UI_DIST = join(ROOT, "ui", "dist");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

function send(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function serveStatic(res: ServerResponse, url: URL): boolean {
  if (!existsSync(UI_DIST)) return false;
  // normalize() before joining, so "../" in a URL cannot climb out of dist.
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  let file = join(UI_DIST, rel);
  if (!file.startsWith(UI_DIST)) return false;
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(UI_DIST, "index.html");
  if (!existsSync(file)) return false;
  res.writeHead(200, {
    "content-type": MIME[extname(file)] ?? "application/octet-stream",
    "cache-control": rel === "/" || rel.endsWith(".html") ? "no-store" : "max-age=3600",
  });
  createReadStream(file).pipe(res);
  return true;
}

export async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (url.pathname === "/api/whoami") {
    return send(res, 200, { app: C.app.id, name: C.app.name, version: C.app.version, token: C.server.whoami_token });
  }
  if (url.pathname.startsWith("/api/")) return send(res, 404, { error: "No such route." });
  if (serveStatic(res, url)) return;
  res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
  res.end(`${C.app.name}: the interface is not built yet. Run ./install.sh (or npm run build) and reload.`);
}
