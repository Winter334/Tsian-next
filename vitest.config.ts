import { resolve } from "node:path"
import { defineConfig } from "vitest/config"

export default defineConfig({
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
    environmentMatchGlobs: [
      ["packages/play-bridge/**/*.test.ts", "happy-dom"],
    ],
  },
})
