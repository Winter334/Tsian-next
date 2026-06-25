# Tool Result Structure Followup

临时跟进文档。记录在「游戏前端/桌面助手 工具调用显示优化」任务调研期间发现的、**不纳入该任务**但**计划紧接着跟进**的技术债。

## 背景

工具显示优化任务聚焦 UI 旁路（`turn-tool` 事件 payload + 前端渲染 + agent_call 结构化展示），全程不触碰喂回模型的 observation 路径。本文件记录的是后者里的一个结构设计张力点。

## 待跟进项：native 模式 tool message content 冗余包装

### 现状

`formatRuntimeWorkspaceToolObservationMessage`（`apps/platform-web/src/agent-runtime/workspace-tools.ts:2350`）对 text-protocol 和 native 两种模式统一序列化：

- 把整个 `RuntimeWorkspaceToolObservation` 容器 `JSON.stringify(observations, null, 2)`
- 包进 `<tsian-tool-observation>` 标签
- 前缀引导语 `"Workspace tool observations:"`，后缀 `"Use these observations to continue..."`

native 模式下（`agent-runtime/index.ts:1640-1647`）每个 observation 被包成 `role:"tool"` message，但 content 仍是上述完整包装文本。

### 问题

native 模式下 `index` / `name` / 容器外壳是冗余的——这些信息已被 `toolCallId` 关联隐含，`index` 是 text 模式定位用的，`name` 在 tool_use 请求里已有。每个 tool message 重复一遍引导语 + 标签 + 外壳，固定开销约 80 token/调用。

对比 Claude native `tool_result.content` 直接放结果、OpenAI tool message 直接放结果字符串，Tsian 的包装偏离了 provider native function calling 的训练分布形态（强模型能处理，但非最优输入）。

### 为什么没纳入显示优化任务

这条改动**直接动 model context**，会改变模型看到的输入形态，可能影响 agent 行为质量。需要：

- 单独的 design 评估（去到什么程度？`ok`/`error` 在裸 content 里怎么表达？text 与 native 路径如何清晰分界？）
- 回归测试（对比改前后 agent 在多工具调用场景的表现）

混进本该低风险的 UI 显示改动会让 scope 失控、背上 model behavior 回归风险。

### 涉及位置

- `apps/platform-web/src/agent-runtime/workspace-tools.ts:2350` `formatRuntimeWorkspaceToolObservationMessage`
- `apps/platform-web/src/agent-runtime/index.ts:1645` native 模式 tool message content
- `apps/platform-web/src/agent-runtime/index.ts:1907` text-protocol 模式 observation 注入

### 设计约束（调研已确认）

- text-protocol 模式保持现状是对的——text 模式没有 `toolCallId` 关联，需要容器外壳的 `index`/`name` 标识 observation 与调用的对应关系。问题只在 native 模式。
- observation 容器结构（`{index, name, ok, result?, error?, imageParts?}`）本身设计合理：`ok`/`result`/`error` 分离、`truncated` 标志、`imageParts` 独立通道剥离 base64，都是成熟设计，不需要动。要动的是**序列化包装方式**，不是容器本身。

## 关联

工具显示优化任务（待建 Trellis 任务）的 `design.md` 应在「不影响 master 上下文」约束里引用本文件，说明为何显示改动严格限定在 UI 旁路。
