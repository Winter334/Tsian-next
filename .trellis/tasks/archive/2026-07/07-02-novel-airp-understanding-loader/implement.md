# Implement — 小说 AIRP 理解阶段 SVG 魔法阵 Loader

执行顺序按此 checklist 推进。当前任务已从 Three.js/Logo 裂隙方案转向随机 SVG 魔法阵；旧 scratch 试验最终清理。

## 阶段 0：回退 Three 与清理旧试验

- [ ] 0.1 `npm uninstall three --workspace play-frontend-dev`，移除已安装依赖。
- [ ] 0.2 删除旧 scratch：`knot-test.html`、`logo3d-test.html`、`rift-logo-test.html`、`logo-focus-test.html`（如果存在）。
- [ ] 0.3 🚦 验证：`rg -n '"three"|from "three"|from \'three\'' apps/play-frontend-dev package-lock.json` 无结果。

## 阶段 1：scratch 原型

- [ ] 1.1 新建 `apps/play-frontend-dev/scratch/magic-circle-test.html`。
- [ ] 1.2 在 scratch 中实现 seeded PRNG、极坐标、circle/polygon/path/textPath 基础函数。
- [ ] 1.3 实现第一版随机层次：外层 n-gram/starburst、中层符文环、内层星阵、中心 glyph。
- [ ] 1.4 实现 Tsian 主题色：琥珀/古金/暖白/余烬灰/血珀，透明背景。
- [ ] 1.5 实现 CSS 动效：整体显现 + 多层低速反向旋转 + 核心呼吸。
- [ ] 1.6 🚦 用户 review：确认小尺寸可读、仪式感足够、随机差异明显。

## 阶段 2：生成器模块

- [ ] 2.1 新建 `apps/play-frontend-dev/src/components/setup/step2/magicCircleGenerator.ts`。
- [ ] 2.2 将 scratch 中生成逻辑迁入 TypeScript：`generateMagicCircle(seed?): { viewBox, layers }`。
- [ ] 2.3 固定符号集常量，优先使用兼容字符；避免用户输入。
- [ ] 2.4 为 `v-html` 安全边界加注释：本地生成、固定函数/符号集、无外部输入。

## 阶段 3：接入 UnderstandingRunning.vue

- [ ] 3.1 移除 GSAP 依赖和"源文鳞阵"代码：`startScalesAnimation`、`scalesTl`、`scaleFieldRef`、`COLUMNS/ROWS/CELL`、`watch(agentHeartbeat)`。
- [ ] 3.2 引入 `generateMagicCircle`，组件 mount/setup 时生成一次。
- [ ] 3.3 Template：用 `.magic-circle` + `<svg class="magic-circle-svg" :viewBox="..."><g v-html="..." /></svg>` 替换 `.scale-field`。
- [ ] 3.4 Style：新增 magic circle 尺寸、glow、appear、layer rotate、core breathe CSS；保留 stage text / hint CSS。
- [ ] 3.5 🚦 手测：进入理解阶段，魔法阵显示并旋转，文案仍在下方。

## 阶段 4：随机性与视觉调优

- [ ] 4.1 多次刷新/重新进入理解阶段，确认魔法阵结构不同。
- [ ] 4.2 控制复杂度：220～260px 下不糊、不乱。
- [ ] 4.3 调整 stroke-width、opacity、旋转速度、符文数量。
- [ ] 4.4 🚦 用户确认最终视觉。

## 阶段 5：最终质量门

- [ ] 5.1 删除 scratch 文件或保留仅在用户要求下；默认不入最终代码。
- [ ] 5.2 🚦 `rg -n "scale-field|scale-col|scale-dot|源文鳞阵|sssscales|agentHeartbeat|three" apps/play-frontend-dev/src` 确认无相关残留（`agentHeartbeat` 在 `useSetupState.ts` 可保留；这里只确认 `UnderstandingRunning.vue` 不消费）。
- [ ] 5.3 🚦 `npm run build --workspace play-frontend-dev`；若失败，区分本任务错误和既有基线错误并如实记录。
- [ ] 5.4 触发 `/trellis-check` 跑质量验证。

## 回滚点

- scratch 魔法阵效果不满意 → 不接入 Vue，继续调生成器模板。
- 接入后动画过重/不清晰 → 降低层数、符文数量、stroke-width 和 glow。
- `v-html` 被判定不可接受 → 生成器改为返回结构化数组，由 Vue 模板 `v-for` 渲染。
