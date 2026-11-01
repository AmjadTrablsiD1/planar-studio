import { defineConfig } from "@playwright/test";
import constants from "./shared/constants.json" with { type: "json" };

// A pinned port, because the suite must serve its own build rather than
// attaching to whatever happens to be running. main.ts treats an explicit
// --port as "serve here" for the same reason.
const PORT = 5196;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 240_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    testIdAttribute: "data-test",
    baseURL: `http://${constants.server.host}:${PORT}`,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    // Software WebGL, so the suite does not depend on the GPU of the machine.
    launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
  },
  webServer: {
    command: `npm --prefix ui run build && node main.ts --port ${PORT} --no-open`,
    url: `http://${constants.server.host}:${PORT}/api/whoami`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
