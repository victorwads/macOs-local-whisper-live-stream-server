import { defineConfig } from "vite";

export default defineConfig({
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
