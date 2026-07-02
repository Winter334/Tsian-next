# Design — 小说 AIRP 理解阶段 SVG 魔法阵 Loader

## 设计边界

本设计替代此前 Three.js / Logo 裂隙 / 心跳方案。最终实现只涉及：

1. `apps/play-frontend-dev/src/components/setup/step2/UnderstandingRunning.vue` —— 替换圆点网格为 SVG 魔法阵，保留文案。
2. 可选新增 `apps/play-frontend-dev/src/components/setup/step2/magicCircleGenerator.ts` —— 本地随机 SVG 生成器。
3. `apps/play-frontend-dev/package.json` / `package-lock.json` —— 移除已安装的 `three` 依赖。

不动 `useSetupState.ts`、`SetupWizard.vue`、`UnderstandingReady/Failed.vue`。

## 一、总体视觉

Loader 是一个 220～260px 的透明 SVG 魔法阵，采用 Tsian 主题色：

- 主线条：`--ember-bright` / `--ember`
- 符文：`--prose`
- 弱线：`--whisper`
- 点缀：`--blood`

结构来自多层几何：

1. 外层 starburst：n-gram、弧线星阵、多边星随机选择。
2. 中层 text ring：符文/古文字沿圆环排列。
3. 内层 star：星阵、多边形、小圆符号组合。
4. 分隔圆环：若干圆作为层边界。

图案每次 mount 随机生成；颜色不随机。

## 二、生成器设计

### 2.1 文件位置

建议新增：

```text
apps/play-frontend-dev/src/components/setup/step2/magicCircleGenerator.ts
```

导出：

```ts
export interface MagicCircleSvg {
  viewBox: string
  layers: string
}

export function generateMagicCircle(seed = Date.now() + Math.random()): MagicCircleSvg
```

`layers` 是 `<g>...</g>` innerHTML，用于填入 `<svg>`。由于输出完全由本地固定生成器产生、不接收用户输入，`v-html` 风险可控；组件处需要注释说明。

### 2.2 随机数

不用全局 `Math.random()`，使用简单 seeded PRNG，便于一次生成过程内部可复现、调试稳定：

```ts
function mulberry32(seed: number): () => number
```

`generateMagicCircle()` 如果未传 seed，则使用 `Date.now() ^ random` 生成 seed。

### 2.3 坐标系统

沿用示例思路，使用 512×512 viewBox：

- `SIZE = 512`
- `HALF = 256`
- 极坐标 `fromPolar(r, angle)`：`r` 是相对半径（1 到边缘），`angle` 是 0..1 圈。

所有几何函数返回 SVG 字符串，不直接操作 DOM。

## 三、几何函数

保留示例核心概念，但重写为 TypeScript 纯函数：

### 3.1 基础

- `circle(radius, opacity, strokeWidth)`
- `polygon(points, opacity, strokeWidth)`
- `path(d, opacity, strokeWidth)`
- `textOnCircle(radius, text, fontSize, pathId)`

### 3.2 n-gram

- `nGram(n, m, radius, offset)`：普通多边星。
- `nGramCircle(n, m, radius, phi, offset)`：弧线星阵（可先做简化版，用多个圆弧 path）。
- `solidStar(n, radiusOuter, radiusInner, offset)`：内层实心/描边星。

### 3.3 符文环

符号集固定，不接受外部输入：

- 十二星座符号
- 行星符号
- 炼金符号（可选，部分字体兼容性一般）
- 希腊/卢恩等字符

生成时随机选择一个字符集，取 48～96 个字符组成字符串，放到 `<textPath>`。优先使用兼容度高的集合（星座、行星、希腊、卢恩），炼金符号可作为低概率点缀。

### 3.4 随机层次

生成流程：

```ts
function generateMagicCircle(seed): MagicCircleSvg {
  const rng = mulberry32(seed)
  const outer = generateOuterLayer(rng, 0.9)
  const text = generateTextRing(rng, 0.72)
  const inner = generateInnerLayer(rng, 0.48)
  const center = generateCenterGlyph(rng, 0.18)
  return { viewBox: "0 0 512 512", layers: outer + text + inner + center }
}
```

每层都包在带 CSS class 的 `<g>`：

```svg
<g class="magic-layer magic-layer--outer">...</g>
<g class="magic-layer magic-layer--text">...</g>
<g class="magic-layer magic-layer--inner">...</g>
<g class="magic-layer magic-layer--core">...</g>
```

Vue 组件用 CSS 控制旋转和显现，而不是 SVG 内嵌 `animateTransform`。这样更符合项目样式管理方式。

## 四、动画设计

### 4.1 显现

SVG 容器：

```css
.magic-circle {
  animation: circle-appear 0.8s ease both;
}
```

线条 draw-in 可选：给 path/polygon/circle 设置统一的 `stroke-dasharray` 较困难（不同长度不一），第一版只做整体 opacity/scale 显现：

- opacity 0 → 1
- scale 0.94 → 1
- filter glow 稍微增强再回落

### 4.2 持续旋转

CSS 动画：

```css
.magic-layer--outer { animation: rotate-cw 42s linear infinite; transform-origin: center; }
.magic-layer--text { animation: rotate-ccw 56s linear infinite; }
.magic-layer--inner { animation: rotate-cw 34s linear infinite; }
.magic-layer--core { animation: core-breathe 3.8s ease-in-out infinite; }
```

速度低频，避免眩晕。

### 4.3 Glow

使用 CSS `filter: drop-shadow(...)`，不使用 SVG filter 大量叠加，避免性能不稳定：

```css
.magic-circle-svg {
  filter:
    drop-shadow(0 0 3px rgba(232,169,72,.45))
    drop-shadow(0 0 12px rgba(181,137,61,.2));
}
```

## 五、组件结构

`UnderstandingRunning.vue`：

```vue
<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue"
import { useSetupState } from "../../../composables/useSetupState"
import { generateMagicCircle } from "./magicCircleGenerator"

const { understandingStartedAt } = useSetupState()
const magicCircle = generateMagicCircle()
// elapsed/currentStage 逻辑保留
</script>

<template>
  <div class="understanding-running">
    <div class="loading-core">
      <div class="magic-circle" aria-hidden="true">
        <svg class="magic-circle-svg" :viewBox="magicCircle.viewBox" role="img">
          <!-- Safe: generated locally from fixed functions/symbol sets; no user input. -->
          <g v-html="magicCircle.layers" />
        </svg>
      </div>
      ...stage text / hint...
    </div>
  </div>
</template>
```

如 Vue/ESLint 对 `v-html` 有顾虑，替代方案是让生成器返回结构化数组，再在模板 `v-for` 渲染；但开发成本更高。第一版建议本地生成器 + 注释边界。

## 六、回退 Three

移除：

```bash
npm uninstall three --workspace play-frontend-dev
```

验证：

```bash
rg -n '"three"|from "three"|from \'three\'' apps/play-frontend-dev package-lock.json
```

只允许 `package-lock` 中无 three；scratch 试验文件最终删除。

## 七、风险与缓解

| 风险 | 缓解 |
|---|---|
| 符文字体兼容性不一 | 优先使用星座/行星/希腊/卢恩；炼金符号低概率或后续移除 |
| v-html 安全疑虑 | 输出只来自本地固定函数和常量，不接收用户输入；组件注释说明安全边界 |
| 图案过密，小尺寸糊 | 限制层数与 stroke-width；scratch 先验证 220～260px 可读性 |
| 随机结构偶尔不好看 | 生成器使用有限模板组合，而非完全自由随机；控制半径与层次 |
| 动画眩晕 | 低速旋转，核心呼吸克制 |

## 八、验证方式

1. 先做 `apps/play-frontend-dev/scratch/magic-circle-test.html`，验证生成器输出和 CSS 动画。
2. 用户确认视觉方向后接入 `UnderstandingRunning.vue`。
3. 接入后手测：每次进入理解阶段图案不同、旋转正常、文案保留。
4. 构建验证：`npm run build --workspace play-frontend-dev`。
