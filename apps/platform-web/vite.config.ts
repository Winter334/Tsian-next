import { resolve } from "node:path"
import { defineConfig } from "vite"
import vue from "@vitejs/plugin-vue"

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@tsian/contracts": resolve(
        __dirname,
        "../../packages/contracts/src/index.ts",
      ),
      "@tsian/runtime-core": resolve(
        __dirname,
        "../../packages/runtime-core/src/index.ts",
      ),
    },
  },
})
