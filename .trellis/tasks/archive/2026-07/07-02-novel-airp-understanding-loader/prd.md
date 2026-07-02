# 小说 AIRP 理解阶段加载动画重做

## Goal

开局导入向导的"理解阶段"（Step 2 running 态）加载动画视觉单薄、缺乏仪式感。用 **随机生成的 SVG 魔法阵** 替换现有的"源文鳞阵"GSAP 圆点网格：每次开始理解时生成一个新的 Tsian 配色魔法阵，多层几何/符文/星阵缓慢反向旋转，表达"正在启动术式解析文本"。

本任务放弃 Three.js、Logo 裂隙、心跳感知方案：最终 loader 不引入 3D 依赖，不消费 `agentHeartbeat`，只在开始理解时生成一张魔法阵并持续运转。

## User Value

- 理解阶段从工程感圆点网格变成有叙事感的"术式运行中"，更贴合游戏前端向导的暗色仪式调性。
- 每次进入理解阶段都会生成不同的魔法阵，等待过程更有新鲜感。
- SVG 线条和符文在 220～260px 小尺寸内清晰可读，比复杂裂隙/电弧/3D 特效更稳定。
- 不引入 Three.js，保持包体轻量和实现稳定。

## Confirmed Facts From Repository

- 当前实现：`apps/play-frontend-dev/src/components/setup/step2/UnderstandingRunning.vue`，10×10 GSAP 圆点网格（"源文鳞阵"），100×100px 小框，列级 y 波动 + 圆点级 y/scale 错位。
- 心跳信号源：`apps/play-frontend-dev/src/composables/useSetupState.ts` 的 `agentHeartbeat` ref，由 `tsian.onAgentActivity` 在 `understandingStatus === "running"` 时自增。**新方案不再消费该信号**。
- 理解触发与等待：`startOpeningUnderstanding` await `tsian.invokeAgent("world-architect", ...)`，resolve 后读 `initial-summary.json`，成功→`understandingStatus = "ready"`，失败→`"failed"`。
- 渲染容器：`SetupWizard.vue` 根据 `understandingStatus` 渲染 running/ready/failed 三个组件，`UnderstandingRunning` 仅在 running 态挂载。
- 主题 token：`--void-deep` #0a0506（近黑暖底）、`--ember-glow` #2b0404（暗血红径向）、`--ember-bright` #e8a948（烛火琥珀）、`--ember` #b5893d（古金）、`--blood` #9b3a2e（血珀）、`--prose` #d4c9b4（灰烬暖白）、`--whisper` #5c5347（余烬灰）。全部定义在 `apps/play-frontend-dev/src/lib/tokens.css`。
- 示例参考：`F:\workspace\tmp\magic-circle-generator` 是纯 SVG 生成器，核心元素包括 n-gram/starburst、符文文字环、内层星阵、多层独立 `animateTransform` 旋转。示例无明确 license，因此本任务只借鉴生成思路，不大段复制原脚本。

## Requirements

### R1 — 随机 SVG 魔法阵

- `UnderstandingRunning.vue` 中显示一个 220～260px 的 SVG 魔法阵，替换当前 100×100 圆点网格。
- 魔法阵由多层元素组成：
  - 外层星芒 / n-gram / 弧线星阵；
  - 中层符文文字环；
  - 内层星阵 / 多边形 / 顶点符号；
  - 圆环分隔线。
- 每次进入理解阶段（组件 mount）生成不同图案。
- 生成结果应在小尺寸下清晰，不依赖复杂滤镜或大画幅细节。

### R2 — Tsian 主题配色

- 不使用示例的随机彩色方案。
- 主线条使用 `--ember-bright` / `--ember`。
- 符文使用 `--prose` 或 `--ember-bright`。
- 弱线使用 `--whisper`。
- 点缀可使用 `--blood`。
- SVG 背景透明，不画额外背景，透出向导现有暗色背景。

### R3 — 加载动效

- 开始时魔法阵应有一个短暂显现过程（fade-in 或 draw-in）。
- 加载中多层缓慢旋转：
  - 外层顺时针；
  - 中层逆时针；
  - 内层可更慢或更快；
  - 旋转速度低频克制，不制造眩晕。
- 不做心跳感知，不监听 `agentHeartbeat`。
- 理解成功/失败时可自然卸载；不强制完成态收束。

### R4 — 保留阶段文案与固定提示

- 保留现有四段轮换阶段文案（正在观察导入结构→阅读开头剧情→整理开局资料→正在写入），叠在魔法阵下方。
- 保留底部固定提示「正在处理开局资料，这可能需要一些时间」+ 三点脉冲。
- 文案/提示样式沿用现有 `--font-serif` / `--font-mono` / `--prose-dim` / `--whisper` token。

### R5 — 实现方式与安全

- 不引入 Three.js。
- 不使用外部资源、外部字体、外部脚本。
- 生成器可返回 SVG innerHTML，但内容必须完全来自本地固定函数和固定符号集，不接收用户输入。
- 如果使用 `v-html`，必须只渲染该本地生成器输出，并在代码注释说明安全边界。
- 原示例脚本不直接大段复制，重写为 Vue/TypeScript 友好的生成器。

## Constraints

- **不引入 Three.js**：已安装的 three 依赖需要回退移除。
- **不改向导状态机**：`understandingStatus` 的 running/ready/failed 流转逻辑不变。
- **不新建路由/弹层**：动画内嵌在 `UnderstandingRunning.vue` 现有位置。
- **不做心跳**：`agentHeartbeat` 保留给未来使用，本任务不消费。
- **不随机主题色**：随机的是图案结构，不是颜色体系。

## Acceptance Criteria

- [ ] AC1：`UnderstandingRunning.vue` 用随机 SVG 魔法阵替换"源文鳞阵"圆点网格，魔法阵背景透明，呈 Tsian 琥珀/古金/暖白主题色。
- [ ] AC2：每次进入理解阶段生成不同的魔法阵结构（外层/文字环/内层至少一处变化）。
- [ ] AC3：多层元素持续低频反向旋转，开始时有短暂显现动效。
- [ ] AC4：四段轮换阶段文案 + 底部固定提示保留并正常显示。
- [ ] AC5：不再依赖 Three.js；`apps/play-frontend-dev/package.json` 和 lockfile 中无 three。
- [ ] AC6：原"源文鳞阵"网格代码被移除，无残留 dead code。
- [ ] AC7：`npm run build --workspace play-frontend-dev` 通过；若存在与本任务无关的既有 TS 错误，需要如实记录。

## Out of Scope

- 不改 `useSetupState.ts` 的状态机逻辑、触发逻辑、心跳订阅逻辑。
- 不改 `UnderstandingReady.vue` / `UnderstandingFailed.vue` 内部实现。
- 不改 `SetupWizard.vue` 的视图路由。
- 不做 Three.js、WebGL、Logo 裂隙、电弧、粒子云、心跳联动。
- 不做魔法阵图案持久化；刷新/重新进入理解阶段可重新随机。
