import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5188,
    strictPort: true,
    watch: {
      // Editors/tools rewrite files through temp dirs; watching those aborts
      // chokidar on Windows (EBUSY) and takes the dev server down.
      ignored: ["**/.*.tmpdir/**", "**/*.tmp", "**/.probe*/**"],
      // Atomic saves (write-temp-then-rename) are easy for chokidar to miss on
      // Windows, which leaves Vite serving stale modules. Polling is cheap here.
      usePolling: true,
      interval: 400,
    },
    proxy: {
      "/api": { target: "http://127.0.0.1:8788", changeOrigin: true },
    },
  },
  build: { outDir: "dist", chunkSizeWarningLimit: 1200 },
});
