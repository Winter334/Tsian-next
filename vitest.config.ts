import { resolve } from "node:path"
import vue from "@vitejs/plugin-vue"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "apps/platform-web/src"),
      "@tsian/contracts": resolve(__dirname, "packages/contracts/src/index.ts"),
      "@tsian/play-bridge": resolve(__dirname, "packages/play-bridge/src/index.ts"),
      "@tsian/web-utils": resolve(__dirname, "packages/web-utils/src/index.ts"),
    },
  },
  test: {
    environment: "node",
  },
})
