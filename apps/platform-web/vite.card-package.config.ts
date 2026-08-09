import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { defineConfig } from "vite"

export default defineConfig({
  root: resolve(__dirname, "card-package-harness"),
  publicDir: false,
  base: "./",
  plugins: [{
    name: "card-package-esbuild-wasm",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "esbuild.wasm",
        source: readFileSync(resolve(__dirname, "public", "esbuild.wasm")),
      })
    },
  }],
  esbuild: {
    keepNames: true,
  },
  build: {
    outDir: resolve(__dirname, "dist-card-package-harness"),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "@tsian/contracts": resolve(__dirname, "../../packages/contracts/src/index.ts"),
    },
  },
})
