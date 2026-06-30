import { resolve } from "node:path"
import { defineConfig } from "vite"

// 开发前端：远程前端模式连接平台（platform-web @5173 iframe 加载本 dev server @5174）。
// 协议层走 @tsian/play-bridge（vite alias → 本地源码，热加载）。
// build.minify: false → 产出可读 ESM JS，供助手 agent 在线编辑场景。
// base: "./" → 产物用相对路径（./assets/...），与平台构建引擎产物格式对齐
// （Service Worker 虚拟 URL 下绝对路径失效，必须相对路径）。
export default defineConfig({
  resolve: {
    alias: {
      "@tsian/contracts": resolve(__dirname, "../../packages/contracts/src/index.ts"),
      "@tsian/play-bridge": resolve(__dirname, "../../packages/play-bridge/src/index.ts"),
    },
  },
  server: {
    port: 5174,
  },
  base: "./",
  build: {
    minify: false,
    outDir: "dist",
  },
})
