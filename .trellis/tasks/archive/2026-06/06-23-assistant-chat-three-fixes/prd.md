# 桌面助手对话焦点滚动/工具轮首句丢失/上下文环归零修复

## Goal

修复桌面助手使用中发现的三个独立 bug，让多窗口场景下的对话滚动位置、
工具调用轮的过渡文本、上下文窗口用量在焦点切换/会话重载后都能正确保持。

## Background / Confirmed Facts

三个 bug 根因已通过代码定位确认：

1. **切焦点后对话滚到顶部**：经 playwright 实测确认有两条触发路径，都是
   浏览器对"非活动滚动容器"重置 `scrollTop` 为 0 的行为：
   - **宽屏（视口 > 640px）异步重置（用户实际触发的路径）**：助手窗口失去焦点、
     被另一窗口遮挡后，浏览器在空闲时刻异步把其内部 `messageListRef`（`overflow:auto`
     滚动容器）的 `scrollTop` 重置为 0。实测：切到设置窗口后，rAF/setTimeout 持续
     采样期间 `scrollTop` 保持原值（测量行为推迟重置），采样停止后的空闲时刻才变 0；
     容器 `display/visibility/opacity/几何尺寸`全程不变，非 DOM reorder、非 JS 主动
     设置（AssistantView 无 watch route/activeWindow，focus 时不调 scrollToBottom）。
     用户感知"切回来复位"——实际复位发生在切走的异步空闲时刻，只是切走时助手被
     遮挡看不到，切回来才发现。
   - **窄屏（`max-width: 640px`）display:none 重置**：`style.css:703-716` 媒体查询
     用 `display:none` 隐藏非活动窗口，切回 `display:grid` 时浏览器重置 scrollTop。
     spec `component-guidelines.md:51` 要求窄屏 stacked panel 行为本身保留，问题在
     `display:none` 的实现方式。
   两条路径根因同源：浏览器对非活动/不可见滚动容器的 scrollTop 重置。修复须在
   AssistantView 侧主动保存/恢复滚动位置，不能依赖在复位前捕获（复位是延迟的、且
   被持续测量推迟）。

2. **工具调用轮的首句过渡文本丢失**：`useAssistantTimeline.ts:62-69` 的
   `onRoundEnd` 在 `finishReason === "tool_calls"` 时直接清空 `streamingText`
   （注释称其为"工具调用前后的噪声"）。但该文本是模型在调用工具前输出的
   有意义过渡说明（如"我先看一下游戏卡内容"），流式过程中用户已通过 `onDelta`
   看到它渲染，轮结束被清空后即消失。runtime 层 `ai.ts:1589` 同样把 tool_calls
   轮的 `result.text` 置空，但流式 `onDelta` 已实时推送给前端，故只需修前端丢弃
   逻辑。游戏前端的流式事件通道（`streaming-events.ts`）已通过 `turn-round-end`
   的 `kind: "thought" | "final"` 区分各轮，已具备"辨认区分"能力，无需改动。

3. **上下文窗口重载会话后归零**：`AssistantView.vue:618-620` 的 `contextUsed`
   注释明说"不持久化，刷新归零"。`loadActiveSession`（`AssistantView.vue:666-699`）
   只恢复 `contextTotal`（来自模型定义），从不恢复 `contextUsed`。故每次重新加载
   会话，上下文环的已用值变 0。会话存储结构 `assistant-conversations.ts` 的
   `AssistantSessionSummary` 不含 contextUsed 字段。

## Requirements

### R1: 焦点切换保持滚动位置（宽屏 + 窄屏）

- 宽屏（视口 > 640px）下助手窗口失去焦点（切到其他窗口）再切回，对话记录的
  滚动位置必须保持，不得被浏览器异步重置为顶部。
- 窄屏（`max-width: 640px`）下切换窗口焦点后同样保持滚动位置。
- 不破坏 spec 要求的窄屏 stacked panel 行为（非活动窗口仍不可见/不占位）。
- 修复须在 AssistantView 侧主动保存/恢复 `messageListRef.scrollTop`，不依赖
  在浏览器重置前捕获（重置是延迟异步的）。

### R2: 工具调用轮过渡文本保留显示

- 桌面助手在 `tool_calls` 轮通过 `onDelta` 流式输出的 content（过渡文本），
  轮结束后必须保留可见，不得丢弃。
- 过渡文本按发生顺序平铺在时间线中（该轮工具节点之前），作为正常可见文本呈现。
- 不依赖模型行为（所有 provider 一致生效）。
- 游戏前端渲染由游戏前端自行决定，运行时流式事件已能辨认区分（`turn-round-end`
  的 kind），本任务不改运行时/游戏前端侧。

### R3: 上下文窗口用量跨会话重载保持

- 重新加载会话（刷新/切走再切回/关页面重开）后，上下文环的已用值（contextUsed）
  必须恢复为该会话上次记录的值，不得归零。
- contextTotal 行为不变（来自当前模型 contextWindow）。
- 仅持久化 contextUsed 的最后一次值即可（轻量，不需要逐轮历史）。

## Acceptance Criteria

- [ ] AC1: 宽屏下助手窗口对话记录滚动到中段，切换到其他应用窗口再切回，滚动
      位置保持在原处（不跳到顶部）。窄屏同样验证。
- [ ] AC2: 向助手提问触发工具调用，agent 先输出一句过渡文本（如"我看一下…")
      再调用工具，该过渡文本在工具调用结束后仍可见，不被清除。
- [ ] AC3: 与助手对话若干轮（上下文环显示已用值 > 0），刷新页面或关闭助手窗口
      后重新打开，上下文环的已用值恢复为刷新前的值，不为 0。
- [ ] AC4: `npm run build:web` 通过。

## Out of Scope

- 运行时层（agent-runtime / ai.ts）tool_calls 轮 `result.text` 置空逻辑不动
  （流式已推送，reconcile 用 stop 轮 text，不影响）。
- 游戏前端对流式过渡文本的渲染行为不动（由游戏前端自行决定）。
- 宽屏多窗口层叠滚动行为不动（本身无此 bug）。
- 不做滚动位置的逐窗口持久化（跨刷新恢复），仅修焦点切换的即时重置问题。

## Open Questions

- R2 过渡文本在桌面助手的具体呈现样式与折叠默认状态（见 design 讨论）。
