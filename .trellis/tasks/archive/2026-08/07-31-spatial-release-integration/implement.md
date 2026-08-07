# Spatial 发布集成与功能对等 — Implementation Plan

## 1. Establish the release audit before opening the gate

- [x] 记录当前 `npm run build:web`、Spatial 定向 tests 与 full `npm test` baseline；保留非 Spatial 并行 timeout 的隔离重跑证据。
- [x] 补强 `platform-apps.test.ts` 和 UI-mode tests，使 registry 完整性、production selection、fallback 与 save-before-reload 成为 release contract。
- [x] 建立由 registry 和现有 domain tests 驱动的 route/action parity 清单；不要复制一套易漂移的 application id 真相源。
- [x] 搜索 `pending`、`本地实验`、`仍在适配`、`spatial-lab`、RetroOS presentation 嵌入与 disabled release gate 残留。

Validation checkpoint:

```powershell
npx vitest run apps/platform-web/src/platform-apps.test.ts apps/platform-web/src/config/platform-ui-mode.test.ts
rg -n "SpatialPendingAppSurface|spatial-pending-app|本地实验|仍在逐项适配|SPATIAL_RELEASE_READY = false|spatial-lab" apps/platform-web/src
```

## 2. Make Spatial registry completeness structural

- [x] 将 Spatial application registration 从 `pending | ready` 收敛为 required component contract。
- [x] 更新 registry construction、window descriptor 与 `SpatialWindowSurface` 使用点，不改变 RetroOS registration 或 route identity。
- [x] 删除 `SpatialPendingAppSurface.vue` 及其 CSS；未来缺失 Spatial presentation 应在类型/test 阶段失败。
- [x] 验证 13 个 app、launcher、detail/editor/media identity 和 Play singleton。

Rollback point: registry/window tests 未通过时不进入文案或 gate 变更；不得以恢复 production pending 页掩盖缺失 presentation。

## 3. Finalize concise release guidance

- [x] RetroOS `AppearanceScreen` 将 Spatial 描述改为正式可选模式，并用一段短文说明桌面 Chromium、实验性 HTML-in-Canvas、鼠标/触控板和自动回退。
- [x] Spatial `SpatialSettingsView` 删除“本地实验/门禁关闭”描述，使用同等简短的环境说明。
- [x] 保持 runtime capability/renderer fallback 的具体错误反馈；静态设置文案不复制完整教程。
- [x] 在任务记录中准备公告要点：适用浏览器、Flag、首版环境门槛、RetroOS 回退和已知限制；公告发布本身不成为 runtime dependency。
- [x] 增加/更新相关 presentation tests，断言两套控制面板不再暴露过时实验文案。

## 4. Run cross-child parity, accessibility and resource checks in dev-only mode

- [x] 运行 13 个应用相关 controller/integration tests 与 global surface tests。
- [x] 运行 projection/input、renderer/scheduler/texture/dynamic-media/context lifecycle tests。
- [x] 验证 `prefers-reduced-motion`、keyboard focus、modal isolation 和窗口 mounted-state contracts。
- [x] 修复 audit 发现的集成缺口；保持修复在现有 owner module，不复制领域逻辑。
- [x] 运行 production/source isolation 搜索，确认无 lab、pending surface、experimental probe 和 RetroOS panel embedding。

Focused automation:

```powershell
npx vitest run apps/platform-web/src/platform-apps.test.ts apps/platform-web/src/config/platform-ui-mode.test.ts apps/platform-web/src/spatial
npx vitest run apps/platform-web/src/controllers apps/platform-web/src/components apps/platform-web/src/views
git diff --check
```

## 5. Browser product matrix before enabling production

- [x] 在支持实验 Flag 的桌面 Chromium 中验证进入 Spatial、13 条 route/deep link、launcher 与多窗口 open/focus/drag/resize/minimize/restore/close。
- [x] 验证中央与边缘 click/hover/scroll/context menu、键盘 focus/Tab、文本输入和主要 modal。
- [x] 验证 UI-mode reload 保留 route/business data，不迁移窗口会话。
- [x] 验证 reduced motion、idle texture upload、dirty Source update、dynamic media、minimize/close dispose 和 context restore。
- [x] 在无实验 Flag、coarse pointer 与低于 `1024×640` 的条件下验证完整 RetroOS fallback 和简洁原因提示。
- [x] 对两套控制面板和公告要点进行最终文案审查，确认设置页没有长篇说明。

Rollback point: browser matrix 的任何 blocker 都必须在 gate 仍关闭时修复；不以公告或已知问题替代首版核心输入/回退正确性。

## 6. Open the production release gate last

- [x] 将 `SPATIAL_RELEASE_READY` 打开，并把 UI-mode tests 更新为 production 可选择 Spatial。
- [x] 运行 production build，确认 Spatial chunks 存在且源码/产物无 lab 或 pending marker。
- [x] 重新运行 full tests；任何真实失败先修复，孤立的并行 timeout 必须单测重跑并记录归属。

Final validation:

```powershell
npm run build:web
npm test
git diff --check
```

## 7. Finish gates

- [x] 运行 `trellis-check`，修复 spec、lint/type、test、cross-layer flow 和 consistency drift。
- [x] 使用 `trellis-update-spec` 记录最终 production release、required registry、concise guidance 与 rollback contract。
- [x] 提交 release integration 代码与任务记录。
- [x] 归档 release child，再对父任务全部 acceptance criteria 做最终 review；全部通过后归档父任务。

## Expected Product Write Scope

- `apps/platform-web/src/config/platform-ui-mode.ts`
- `apps/platform-web/src/config/platform-ui-mode.test.ts`
- `apps/platform-web/src/platform-apps.ts`
- `apps/platform-web/src/platform-apps.test.ts`
- `apps/platform-web/src/components/settings/AppearanceScreen.vue`
- `apps/platform-web/src/spatial/apps/settings/SpatialSettingsView.vue`
- `apps/platform-web/src/spatial/shell/SpatialWindowSurface.vue`
- `apps/platform-web/src/spatial/shell/SpatialPendingAppSurface.vue` (delete)
- `apps/platform-web/src/spatial/shell/spatial-shell.css`
- focused tests or existing owner modules only when the release audit exposes a concrete gap

Do not edit `.codex/config.toml`; it is an unrelated user change.
