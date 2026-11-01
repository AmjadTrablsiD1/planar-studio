#!/usr/bin/env node
// The entry point every launcher calls.
//
// Three rules, each written after a launcher went wrong somewhere else:
//   * never hard-code a port -- bind 0 and ask the OS what it gave us,
//   * reuse a server that is already running instead of starting a second one,
//   * only open the browser once *our* server answers, verified by a token
//     rather than by the port being busy, because another local project of his
//     was once listening on the port that had been pinned.

import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { homedir, platform } from "node:os";
import { C } from "./core/constants.ts";
import { handle } from "./server/api.ts";

const PORT_FILE = resolve(C.paths.port_file.replace(/^~/, homedir()));

async function probe(port: number): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 400);
    const r = await fetch(`http://${C.server.host}:${port}/api/whoami`, { signal: ctrl.signal });
    clearTimeout(timer);
    const body = (await r.json()) as { token?: string };
    return body.token === C.server.whoami_token;
  } catch {
    return false;
  }
}

async function alreadyRunning(): Promise<number | null> {
  try {
    const port = Number(readFileSync(PORT_FILE, "utf8").trim());
    return Number.isFinite(port) && (await probe(port)) ? port : null;
  } catch {
    return null;
  }
}

function openBrowser(url: string): void {
  const os = platform();
  const [cmd, args] =
    os === "darwin" ? ["open", [url]] :
    os === "win32" ? ["cmd", ["/c", "start", "", url]] :
    ["xdg-open", [url]];
  try {
    spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
  } catch {
    console.log(`Open ${url} in your browser.`);
  }
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  // An explicit --port means "serve here", so it must not defer to whatever is
  // already running: otherwise starting the dev server or the end-to-end suite
  // while the installed app is open silently starts nothing at all.
  const pinnedAt = argv.indexOf("--port");
  const pinned = pinnedAt >= 0 ? Number(argv[pinnedAt + 1]) : null;
  const noOpen = argv.includes("--no-open");

  if (pinned === null) {
    const running = await alreadyRunning();
    if (running !== null) {
      console.log(`${C.app.name} is already running on port ${running} - opening it.`);
      if (!noOpen) openBrowser(`http://${C.server.host}:${running}/`);
      return 0;
    }
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  await new Promise<void>((ok) => server.listen(pinned ?? C.server.port, C.server.host, ok));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  mkdirSync(dirname(PORT_FILE), { recursive: true });
  writeFileSync(PORT_FILE, String(port));

  const url = `http://${C.server.host}:${port}/`;
  console.log(`${C.app.name} ${C.app.version} on ${url}`);
  if (!noOpen) openBrowser(url);

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      server.close(() => process.exit(0));
    });
  }
  return 0;
}

main().then((code) => {
  if (code !== 0) process.exit(code);
});
