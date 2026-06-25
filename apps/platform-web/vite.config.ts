import { resolve } from "node:path"
import { defineConfig } from "vite"
import vue from "@vitejs/plugin-vue"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "@tsian/contracts": resolve(
        __dirname,
        "../../packages/contracts/src/index.ts",
      ),
      "@tsian/runtime-core": resolve(
        __dirname,
        "../../packages/runtime-core/src/index.ts",
      ),
      "@tsian/play-bridge": resolve(
        __dirname,
        "../../packages/play-bridge/src/index.ts",
      ),
    },
  },
})
