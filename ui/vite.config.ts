import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { resolve } from "node:path";
import constants from "../shared/constants.json" with { type: "json" };

// core/ and shared/ live above this directory; the UI imports the design core
// directly (and runs the optimiser from it in a worker), so every number on
// screen comes from the same tested functions as the exports.
export default defineConfig({
  plugins: [react()],
  server: {
    fs: { allow: [resolve(import.meta.dirname, ".."), resolve(import.meta.dirname)] },
    proxy: { "/api": { target: "http://127.0.0.1:5194", changeOrigin: true } },
  },
  worker: { format: "es" },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1600,
    rollupOptions: { output: { manualChunks: (id: string) => (id.includes("node_modules/three") ? "three" : undefined) } },
  },
  define: { __APP_VERSION__: JSON.stringify(constants.app.version) },
});
