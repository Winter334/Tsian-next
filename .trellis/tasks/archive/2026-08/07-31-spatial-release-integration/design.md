# Spatial 发布集成与功能对等 — Technical Design

## 1. Purpose and Boundaries

本任务是 Spatial 父任务的最终集成与 release gate，不再建立第三套实现或重做七个已归档子任务。它负责把已存在的 engine、shell、13 个 platform application presentation 和 global surfaces 收敛成可发布状态，并补足跨子任务才能完成的验证证据。

边界保持不变：

- RetroOS 仍是默认模式和完整回滚路径。
- platform config 中的 `appearance.uiMode` 仍是唯一持久化偏好；切换先完整保存再 reload，不迁移窗口会话。
- `platformAppRegistry` 仍是 app id、route、identity、launcher 和两套 presentation 的唯一来源。
- Source DOM 仍拥有布局、语义、焦点与事件；GPU renderer 只拥有视觉合成和空间几何。
- HTML-in-Canvas 不支持、WebGL 初始化失败或 renderer 失败时回退 RetroOS，不修改保存偏好。
- 本任务不改 Game Card iframe 内容、存储 schema、后端或 shared contracts。

## 2. Release Topology

```text
platform config: appearance.uiMode
  -> resolveUiMode(fine pointer, viewport, production gate)
      -> retro: existing DesktopShell
      -> spatial: lazy SpatialDesktopShell
          -> capability adapter (HTML-in-Canvas + WebGL2)
              -> ready: shared registry + Spatial presentations
              -> unsupported/error: explicit fallback -> RetroOS
```

生产 gate 继续保留为一个可回滚常量，但本任务完成时从关闭改为打开。gate 只决定 production 是否允许选择 Spatial，不替代 fine-pointer、viewport、HTML-in-Canvas 或 renderer capability 检测。

## 3. Registry Closure

当前 13 个 application definition 都已有 Spatial component，因此发布态不再需要 `"pending" | "ready"` 双态：

- 将 Spatial registration 收敛为 required component + geometry/fullscreen metadata。
- 删除 `SpatialPendingAppSurface.vue`、对应 CSS 和 `SpatialWindowSurface` 的 pending 分支。
- registry test 断言每个定义均有可渲染 Spatial component，并继续验证 route/launcher identity、detail/editor/media 多实例与 Play singleton。
- 不保留手写“当前已适配 app id 集合”；未来新增 app 若未提供 Spatial presentation，应在类型或 registry test 阶段直接失败，而不是生产时显示占位页。

这使“全部应用完整”成为可执行 contract，而不是 release checklist 中容易漂移的文字。

## 4. Production Selection and Concise Guidance

发布顺序为：先让开发模式完成全部自动化和浏览器验收，再打开 `SPATIAL_RELEASE_READY`，最后运行 production build/test。

控制面板文案遵循用户确认的两层沟通：

- RetroOS 与 Spatial settings 都只显示一段短说明，例如“需要桌面版 Chromium、实验性 HTML-in-Canvas 与鼠标/触控板；不兼容时自动回退 RetroOS”。
- 不在设置页加入 Flag 开启教程、兼容表或大段实验说明。
- 发布公告承载版本、Flag 入口、已知限制与回退说明；代码库只需准备简洁公告要点，不让 shell correctness 依赖公告是否已加载。
- 运行时 fallback 继续报告具体失败原因，因为它服务故障恢复，不属于静态说明堆积。

## 5. Parity Audit Model

发布审计分成四层，避免一个脆弱的端到端用例假装覆盖全部功能：

1. **Registry/route automation**：13 个应用、launcher、deep link、detail/editor/media identity、Play singleton、UI-mode save/reload。
2. **Existing domain tests**：library/market、workspace、Studio/Assistant、system、Play/global 子任务留下的 controller 与 integration tests。
3. **Cross-shell release checks**：生产 gate、全部 Spatial component、无 pending/lab/RetroOS chrome 残留、unsupported fallback、reduced motion 与 resource lifecycle。
4. **Browser product matrix**：真实 Chromium + Flag 的曲面渲染/输入/窗口流程，以及无 Flag、窄视口和不支持环境的 RetroOS fallback。

审计发现的缺口只在其所有权边界内修复；若是领域功能缺失，优先补 shared controller 或对应 Spatial presentation，不复制 RetroOS 业务代码。

## 6. Accessibility, Visual and Performance Gates

### Accessibility

- keyboard-only 验证模式选择、launcher、窗口 focus/minimize/close、主要表单与 modal。
- 检查 Source DOM 的 label/role/focus order 与 captured focus-visible 状态。
- `prefers-reduced-motion` 下冻结持续装饰时间源，功能与输入不变。

### Visual

- 独立浅曲面与 pose、至少三层空间深度、窗口位置不因 focus 改变。
- 灰白无纹理实体窗口、左右顶部突出块、无 window shadow/rim/glow、可读正文与表单。
- 无 `spatial-lab`、pending application、实验 probe 或 RetroOS presentation 嵌入。

### Performance and resources

- 使用现有 metrics、scheduler、texture registry、dynamic media 与 context lifecycle tests 作为自动化证据。
- 浏览器中观察 idle scene 不持续 texture upload，dirty Source 只触发必要更新，minimize/close 后资源释放，context restore 可恢复操作。
- 本任务不引入新的遥测后端或凭空设定无法稳定测量的 FPS SLA；以事件驱动 idle、无泄漏和交互可用性作为首版 release invariant。

## 7. Compatibility and Rollback

- production gate 是即时回滚开关；关闭后 production resolution 回到 RetroOS，不需要数据迁移。
- 默认配置仍为 `retro`，已有用户数据和 route 不变。
- 用户保存了 `spatial` 但环境不再满足要求时，本次启动回退 RetroOS，同时保留偏好，未来环境恢复后可再次进入 Spatial。
- announcement 属于发布沟通，不是 runtime dependency；公告失败不得影响平台启动或回退。

## 8. Risks

- **Gate 早开**：在 browser matrix 和 full test 之前修改常量会暴露半完成状态；实现计划把 gate 变更放在最后一个 product checkpoint。
- **测试清单漂移**：手写 app id 或单独 parity 文档会落后于 registry；用 required Spatial component 和 registry-derived assertions 防止。
- **实验 API 差异**：current/legacy upload negotiation 保持封装在 capability adapter；release integration 不把非标准 API 扩散到 shell。
- **全仓测试时限抖动**：记录首轮失败并隔离重跑；产品失败与并行超时必须分别判定，不能忽略真实红灯。
- **文案膨胀**：设置页只有短提示，详细 Flag 配置进入公告草稿，不在两个控制面板复制长文。

## 9. Rollback Points

1. Registry 收敛后：所有 registry/window tests 必须先通过；否则恢复 required component 之前先修类型/route drift，不恢复生产占位。
2. Browser matrix 后、gate 打开前：任何输入、fallback 或 resource blocker 都在 dev-only 状态修复。
3. Gate 打开后：production build/full test 若失败立即保持 gate 关闭，直到同一改动集全部通过。
