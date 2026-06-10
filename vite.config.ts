import { defineConfig } from "vite";

export default defineConfig({
  root: "src/client",
  publicDir: "../../public",
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true
  },
  server: {
    proxy: {
      "/api": "http://localhost:8787"
    }
  }
});
