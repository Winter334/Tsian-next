# Implementation Plan: 父任务最终综合集成验证

## 0. Preflight and Activation

- [x] 确认四个子任务均已归档，父任务进入 [4/4 done]。
- [x] 读取父任务 `prd.md`、本 `implement.md`、`implement.jsonl`、`check.jsonl`。
- [x] 运行 `git status --short`，确认当前已有 frontend-inspection 无关改动和 `tmp/`，本阶段只提交/归档父任务验证产物。
- [x] 用户确认开始后运行 `task.py start 07-10-browser-frontend-builder-official-adapters`。

## 1. Fixture Source Package

- [x] 在父任务 `research/final-integration-fixture/` 构造可复现源码型 frontend fixture。
- [x] 生成 `.tsian-frontend.zip` 只放未跟踪 `tmp/`。
- [x] `frontend.json` 使用 `schema: "tsian.frontend-package.v1"`、`entry: "dist/index.html"`、`framework: "vue"`、`bridgeVersion: "tsian.play-bridge.v1"`。
- [x] 文件列表覆盖所有 fixture 文件，并确保 archive paths 不带 `frontend/` 前缀。

## 2. Capability Coverage

- [x] Vue SFC `<script setup>`、本地组件、`@/` alias、extension-less import、scoped style、CSS Modules、asset `url(...)`。
- [x] Sass/SCSS standalone 和 Vue `<style lang="scss">`，Less standalone 和 Vue `<style lang="less">`，含相对 import/变量。
- [x] `import.meta.glob` lazy/eager、relative/`@/`、empty match、排序可观察、Vue script 内使用。
- [x] Worker `import WorkerCtor from "./workers/calc.worker.ts?worker"`、message round-trip、Worker 内 VFS 依赖、JSON、`?raw`、`?url`、dynamic import chunk、`import.meta.glob`。
- [x] 页面 DOM 暴露可检查结果：worker result、glob keys、style marker、asset URL marker。

## 3. Real Product Loop Validation

- [x] 启动/使用 platform-web 浏览器页面。
- [x] 创建或选择非 builtin 本地游戏卡。
- [x] 通过真实 frontend package import 路径导入 fixture zip，让平台写入 IndexedDB 并触发 browser esbuild-wasm 构建。
- [x] 打开 `/play` packaged iframe。
- [x] 检查 DOM：fixture root rendered、glob keys、style markers、worker round-trip result。
- [x] 检查 Console：无构建器/Worker runtime 错误。
- [x] 检查 Network：`frontend/dist/index.html`、主 chunks/assets、Worker entry/chunks/assets 均从 SW-backed virtual URL 加载，无新增 404。
- [x] 查询/观察 frontend-build status 为 ok。

## 4. Failure Diagnostics / Old Dist Retention

- [x] 使用失败变体或编辑 fixture 源码触发至少一个代表性构建失败（例如 direct `new Worker(...)`、`?worker&url`、Worker 内 bare import 或 bad glob）。
- [x] 验证 build status message 包含能力/文件/原因。
- [x] 验证失败后不替换旧 dist，已加载 iframe 或重载后仍保留上一次成功结果。

## 5. Real play-frontend-dev Regression

- [x] 构造或导出现有 `apps/play-frontend-dev/src` 源码包，按真实 frontend package import 路径导入到本地卡。
- [x] 验证在线构建成功，packaged iframe 可渲染，无构建器相关 Console/Network 错误。
- [x] 如该回归因当前未纳入 package generation 脚本而无法完整执行，记录明确原因和下一步，不误标完成。

## 6. Record and Finish

- [x] 写入 `research/final-integration-validation.md`，记录 fixture 结构、zip 生成命令、成功/失败/回归证据、Console/Network 摘要和已知限制。
- [x] 更新父任务 `prd.md` Cross-Child Acceptance Criteria。
- [x] 运行 `git diff --check`。
- [x] 如修改 platform-web 代码则运行 `npm run build:web`；纯 research/task artifact 可引用最近 `build:web` 结果并按需复跑。
- [x] 运行 `trellis-check`。
- [x] 提交父任务验证产物，归档父任务。

## Rollback / Safety

- 只提交父任务 `.trellis/tasks/07-10-browser-frontend-builder-official-adapters/**` 验证产物，避免夹带当前 frontend-inspection 无关改动。
- 二进制 zip 留在 `tmp/`，不提交。
- 若浏览器产品回路发现构建器缺陷，回到对应能力实现修复并重新验证，不强行归档父任务。
