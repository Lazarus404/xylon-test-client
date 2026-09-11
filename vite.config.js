import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  base: "/client/",
  build: {
    outDir: "dist",
    emptyOutDir: true
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "strike-fw"
  },
  server: {
    port: 5173,
    proxy: {
      "/sip": {
        target: "http://127.0.0.1:8080",
        ws: true
      },
      "/v1": {
        target: "http://127.0.0.1:8080",
        ws: true
      }
    }
  }
});
