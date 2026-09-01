# 替换平台开屏为 Tsian Boot 蓝屏彩虹猫流程

## Goal

用新的 Tsian Logo Gate → Tsian Boot → 恶趣味假蓝屏 → 彩虹猫流程替换 `apps/platform-web` 当前 typewriter/CRT 开屏，让平台启动成为一个可记忆的恶作剧式小剧场，同时满足浏览器音频播放和全屏必须由用户手势触发的限制。

## Background / Confirmed Facts

- 当前 Tsian 开屏由 `apps/platform-web/src/App.vue:1-17` 挂载：`DesktopShell` 在底层，`SplashScreen` 在上层。
- 当前 `App.vue` 开屏状态机在 `apps/platform-web/src/App.vue:32-53`：`typing -> animating -> done`，旧开屏点击后触发 `animate-crt-switch`。
- 当前 `apps/platform-web/src/components/SplashScreen.vue:1-69` 使用 `useTypewriter` 做打字机开屏，点击任意位置 emit `exit`。
- 旧 CRT 过渡样式在 `apps/platform-web/src/style.css:741-776`，当前只被旧开屏状态机引用。
- `apps/platform-web` 当前没有 `requestFullscreen()` / native host / Electron / Tauri 全屏能力；真实浏览器全屏需要用户手势。
- `F:\workspace\reverse\nyan-cat-vue` 是 prototype 来源，不是最终集成目标。
- prototype 已验证 Nyan Cat 资源和流程：GIF/MP3 位于 `public/nyan/technyancolor.*`；蓝屏点击后音频可播放；彩虹锚点可藏入猫身体中心；猫宽 `250px`、彩虹高 `96px` 效果较好。
- Tsian 主题变量和 CRT 基础样式位于 `apps/platform-web/src/style.css:4-33`、`apps/platform-web/src/style.css:153-166`。

## Requirements

### R1. 替换当前 Tsian 开屏流程

- 废弃 `apps/platform-web` 当前 typewriter 开屏体验。
- 新开屏仍由 `SplashScreen` 对外 emit `exit`，以便 `App.vue` 在开屏结束后显示桌面。
- `DesktopShell` 可以继续在底层预挂载，但用户看到的开屏体验应由新流程完整控制。

### R2. 三段点击流程

新开屏必须按以下流程运行：

1. **第 1 次点击**：初始 Tsian logo gate 显示后，用户点击任意位置进入 boot；该点击同步尝试 `requestFullscreen()`。
2. **第 2 次点击**：BSOD 阶段任意进度点击/触摸/按键都可提前触发彩虹猫；该手势同步触发音频播放并兜底尝试全屏。
3. **第 3 次点击**：彩虹猫 idle 阶段点击后离场，音乐淡出，最终 emit `exit` 进入平台桌面。

### R3. Tsian Logo Gate

- 页面初始不直接进入 boot，不直接播放音乐，不直接显示蓝屏。
- 首屏显示 Tsian 风格 logo / wordmark。
- Logo gate 应有启动仪式感：Tsian 字标可拆分成字母、像素碎片或终端块，并通过 CRT/故障扫描感动效重组出现。
- 整个首屏都可点击进入下一阶段。
- 视觉应符合 Tsian RetroOS 暖色 CRT 主题。

### R4. Tsian Boot

- 第 1 次点击后进入 boot。
- Boot 阶段使用 Tsian 风格，不沿用 standalone prototype 的普通黑屏 boot。
- Boot 进度应动态增长并到达 99%，而不是一开始就是 99%。
- 到达 99% 后短暂停顿，再自动切换到 BSOD。

### R5. 假蓝屏 BSOD

- BSOD 视觉尽量接近 Windows 8 蓝屏：蓝底、大号 `:(`、白色稀疏排版、百分比文案。
- 不显示 `Press anywhere` / `Click to restart` 等显式点击提示。
- BSOD 文案必须明显恶趣味，玩家看内容能知道是假的，例如 `NYAN_CAT_OVERFLOW` / `technyancolor.sys`。
- BSOD 百分比从低值动态增长到 99%，期间不锁点击行为。
- 玩家可在 BSOD 任意进度提前点击/触摸/按键进入彩虹猫。
- `Escape` 不应触发彩虹猫流程，以免用户想退出全屏时被误拦截。

### R6. 彩虹猫与音乐

- 彩虹猫资源来自 prototype：`technyancolor.gif` 和 `technyancolor.mp3`。
- 彩虹猫入场应和音乐淡入同步开始。
- 音乐必须由 BSOD 阶段的用户手势触发 `audio.play()`，避免浏览器 autoplay 限制。
- 音频初始音量为 `0`，播放后淡入到目标音量。
- 彩虹与猫身体应保持连接：彩虹右端藏入猫身体中心，保留猫咪横向漂移。
- 猫咪不应被过度放大导致模糊；保留像素图渲染设置。

### R7. 安全与用户控制边界

- 不使用 Microsoft / Windows 标识。
- 不写真实系统路径或真实恐吓式病毒文案。
- 不隐藏鼠标、不锁鼠标、不阻止退出全屏。
- 不无限循环蓝屏。
- 全屏失败时流程仍可继续。

### R8. 首次播放与跳过策略

- 新开屏完整小剧场不应在每次进入平台时重复打扰用户。
- 应采用同设备永久跳过策略：完整流程结束并进入桌面后写入本地版本 key；同一浏览器/设备后续打开平台直接进入桌面。
- 应支持本浏览器/本设备记忆“已看过当前版本完整开屏”。
- 记忆应使用版本化 key，便于未来开屏内容升级后重新播放一次。
- 登录态可作为补充上下文，但不应成为唯一跳过依据，因为 `initAuth()` 是异步流程，开屏可见性需要在启动早期同步决策。
- 若读取或写入浏览器持久化失败，应回退为正常播放，不阻塞平台启动。

## Acceptance Criteria

- [ ] `apps/platform-web` 打开后初始显示 Tsian logo gate，而不是旧 typewriter 开屏。
- [ ] Logo gate 中 Tsian 字标以拆分/重组/CRT 故障感动效出现，且整个首屏都可点击。
- [ ] 第 1 次点击任意位置后进入 boot，并同步尝试浏览器全屏。
- [ ] Boot 使用 Tsian RetroOS 风格，进度动态增长到 99%，然后自动进入 BSOD。
- [ ] BSOD 视觉接近 Windows 8 蓝屏，但文案明显是 Nyan/Tsian 恶趣味假蓝屏。
- [ ] BSOD 进度从低值动态增长，不是一进入就是 99%。
- [ ] BSOD 未到 99% 时点击也能提前进入彩虹猫。
- [ ] BSOD 阶段按 `Escape` 不触发彩虹猫流程。
- [ ] 彩虹猫入场时音乐开始播放并淡入；浏览器控制台不出现未处理的 autoplay 异常。
- [ ] 彩虹与猫身体保持连接，猫咪像素图清晰。
- [ ] 彩虹猫 idle 阶段显示进入提示；第 3 次点击后猫咪离场、音乐淡出并进入平台桌面。
- [ ] 完整播放并进入桌面后，本浏览器/本设备后续打开平台可跳过完整开屏，避免重复打扰。
- [ ] 跳过记忆使用版本化 key；升级开屏版本时可重新播放。
- [ ] `npm run build:web` 或等效 `platform-web` 构建通过。
- [ ] 不新增运行时依赖。

## Out of Scope

- 不继续修改 `F:\workspace\reverse\nyan-cat-vue`，它只作为 prototype 来源。
- 不新增 Electron/Tauri/native host 全屏能力。
- 不实现无用户手势的真实自动全屏。
- 不替换平台桌面本身或现有 `DesktopShell` 行为。
- 不修改 contracts / backend API。

## Open Questions

- None.
