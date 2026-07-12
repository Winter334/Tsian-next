import { resolve } from "node:path"
import { defineConfig } from "vite"
import vue from "@vitejs/plugin-vue"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  // Dart Sass's browser build relies on runtime constructor/function names.
  // Keep them intact in production minification as required by its bundler docs.
  esbuild: {
    keepNames: true,
  },
  server: {
    proxy: {
      "/api": "http://localhost:8080",
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "@tsian/contracts": resolve(
        __dirname,
        "../../packages/contracts/src/index.ts",
      ),
      "@tsian/web-utils": resolve(
        __dirname,
        "../../packages/web-utils/src/index.ts",
      ),
      "@tsian/play-bridge": resolve(
        __dirname,
        "../../packages/play-bridge/src/index.ts",
      ),
    },
  },
})
