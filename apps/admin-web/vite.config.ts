import { resolve } from "node:path"
import { defineConfig } from "vite"
import vue from "@vitejs/plugin-vue"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  base: "/admin/",
  plugins: [vue(), tailwindcss()],
  server: {
    proxy: {
      "/api": "http://localhost:8080",
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "@tsian/contracts": resolve(__dirname, "../../packages/contracts/src/index.ts"),
      "@tsian/web-utils": resolve(__dirname, "../../packages/web-utils/src/index.ts"),
    },
  },
})
