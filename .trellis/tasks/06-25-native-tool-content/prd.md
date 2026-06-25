# native 模式 tool message content 去冗余包装

## Goal

native 模式下 tool message content 去掉冗余的容器外壳/引导语，直接放裸结果。每个 tool 调用约省 80 token，贴合 provider native function calling 训练分布。text 路径不动。

## 背景

`formatRuntimeWorkspaceToolObservationMessage` 对 text/native 统一序列化，native 模式下每个 tool message 包了引导语 + `<tsian-tool-observation>` 标签 + `{index,name,ok,result?,error?}` 容器 JSON。native 模式有 `toolCallId` 关联，`index`/`name`/外壳冗余。详见 `docs/active/tool-result-structure-followup.md`。

## Requirements

### R1 新增 `formatNativeToolObservationContent`
- 成功（`ok:true`）：result 是 string 直放，否则 JSON.stringify(result)
- 失败（`ok:false`）：JSON.stringify(error)（保留 code + message + details）
- 无引导语、无标签外壳、无容器结构

### R2 native 路径改用新函数
- `index.ts:1646` native 模式 tool message content 改用 `formatNativeToolObservationContent(observation)`

### R3 text 路径不动
- `formatRuntimeWorkspaceToolObservationMessage` 保持现状
- `index.ts:1908` text 模式不动

## Acceptance Criteria

- [ ] `formatNativeToolObservationContent` 函数存在，逻辑符合 R1
- [ ] native 路径（`index.ts:1646`）改用新函数
- [ ] text 路径（`index.ts:1908`）未改动
- [ ] `formatRuntimeWorkspaceToolObservationMessage` 未改动
- [ ] `npm run build:web` 通过

## Out of Scope

- 不动 `RuntimeWorkspaceToolObservation` 容器结构
- 不动 text-protocol 路径
- 不动 UI 旁路（buildToolOutput / turn-tool 事件）
- 不动工具执行逻辑
