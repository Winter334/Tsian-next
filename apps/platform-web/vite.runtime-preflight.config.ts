import { resolve } from "node:path"
import { defineConfig } from "vite"

export default defineConfig({
  root: resolve(__dirname, "runtime-preflight"),
  base: "./",
  esbuild: {
    keepNames: true,
  },
  build: {
    outDir: resolve(__dirname, "dist-runtime-preflight"),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "@tsian/contracts": resolve(__dirname, "../../packages/contracts/src/index.ts"),
    },
  },
})
