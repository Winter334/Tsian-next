# Capability: prompt-engine

> 由 OPSX change `prompt-preset-and-workflow-engine` 引入的新 capability。本规约只声明对外行为契约，实现细节见 `openspec/changes/prompt-preset-and-workflow-engine/design.md §1-§3`。

## 1. Purpose

把 [SillyTavern](https://github.com/SillyTavern/SillyTavern) 风格的 PromptPreset（含 prompts / prompt_order / lorebook / regex post-process）转换为 Tsian 工作流引擎可消费的有序 `ChatMessage[]`。底层基于 [fast-tavern](https://github.com/anonymous-fast-tavern) 源码（vendored 入 `packages/prompt-engine/src/`），按 `design.md §1.1` 表格剥离 CharacterCard / GroupChat / QuickReply 与 gemini channel。

## 2. Public API

```ts
// packages/prompt-engine/src/tsian/assemble.ts
export interface AssemblePromptInput {
  preset: PresetInfo;
  macros: Record<string, string>;
  history: ChatMessage[];
  lorebookKeys?: string[];
  characterCard?: CharacterCard | null; // 兼容上游字段，可选
}

export interface AssemblePromptOutput {
  messages: ChatMessage[];
}

export function assemblePromptFromPreset(input: AssemblePromptInput): AssemblePromptOutput;

// 可选：原 ST preset.json 转 PresetInfo
export function convertFromSillyTavern(raw: unknown): PresetInfo;
```

## 3. Behavior Contract

### 3.1 Determinism (P-G-1)
对相同 input（含 macros、history、preset 内容）必须输出完全相同的 `messages`。禁止任何随机源、时间戳、env 读取。

### 3.2 Macro substitution
- 仅做字面量 KV 替换，不解析表达式（无 `{{x+1}}` 一类）
- 点号路径作为字面量 key 查找：`{{globals.foo.bar}}` 直接查 `macros['globals.foo.bar']`
- 平台调用方负责扁平化嵌套对象到点号 key
- 缺失 key 行为：保留原占位字符串（fail-soft，方便调试）；`design.md §3` 已锁定

### 3.3 Macro priority (`§13.5`)
本 capability 不直接处理优先级合并，由调用方（platform-host）按以下顺序合并后传入：

```
platform-builtin  <  mod.manifest.customMacros  <  edge-injection
```

### 3.4 Lorebook activation
活动检测、深度注入、扫描限制均**透传给** vendored fast-tavern 现有逻辑，本 capability 不重新实现。

### 3.5 Regex post-process
对最终 `messages[i].content` 应用 vendored fast-tavern 的正则替换链。

### 3.6 Error modes (HC-9 fail loud)
| 场景 | 行为 |
|------|------|
| `preset` 为 null/undefined | throw `Error("preset required")` |
| preset.prompt_order 引用不存在的 prompt id | throw（不静默丢弃） |
| regex 编译失败 | throw（不跳过该规则） |
| `convertFromSillyTavern` 输入非 ST preset 形态 | throw |

禁止任何 fallback / 静默兜底（CLAUDE.md §7 fail loud > fail silent）。

### 3.7 Vendored source policy (`design.md §1.1`)
- 复制保留：核心 prompt assembling + lorebook + regex modules
- 剥离：CharacterCard branches, Group Chat, Quick Reply, gemini channel converter
- `convertFromSillyTavern` 接收可选 `characterCard` 参数；为 null 时跳过相关增强

## 4. Round-trip Validation (P-G-2)
任意社区流行的 SillyTavern preset.json 经 `convertFromSillyTavern` 不抛错，且最终 `assemblePromptFromPreset` 至少产出 1 条 message。覆盖任务 G4。

## 5. Cross-references
- design.md §1（vendored 范围表）
- design.md §2（macro KV scheme）
- design.md §3（builtin macro list）
- design.md §13.5（macro priority）
- _research-notes.md HC-1（不重写 ST 解析）、HC-9（fail loud）、HC-10（无迁移）、SC-1（build green）

## 6. Out of Scope
- 流式 token 输出（接口预留，本变更不实现，见 design.md §13.8）
- 运行时 prompt 缓存（按 fast-tavern 默认行为）
- Group chat、quick reply、character card UI（已剥离）
