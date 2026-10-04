import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error type error without @types/node package
import process from "node:process";
// @ts-expect-error Node typings are not installed in this frontend project
import { readFile } from "node:fs/promises";
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), {
    name: "activity-local-preview",
    configureServer(server) {
      // Development-only fixed file endpoint: emulates exe-adjacent activities.json in browser preview.
      server.middlewares.use("/__activities/local", async (_request, response) => {
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Content-Type", "application/json");
        try {
          const content = await readFile(new URL("./activities.json", import.meta.url));
          if (content.length > 1_000_000) throw Error("Activity configuration too large");
          response.end(content);
        } catch { response.statusCode = 404; response.end('{"error":"Local activities.json unavailable"}'); }
      });
    },
  }],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**", "**/activity-service/**"],
    },
  },
}));
