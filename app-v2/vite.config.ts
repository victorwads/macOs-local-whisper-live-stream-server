import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      "@logger": "/src/features/system-logs/logger.ts"
    }
  },
  server: {
    host: true,
    port: 4173,
    strictPort: true
  },
  preview: {
    host: true,
    port: 4173,
    strictPort: true
  },
  build: {
    sourcemap: true,
    minify: false,
    target: "es2022"
  }
});
