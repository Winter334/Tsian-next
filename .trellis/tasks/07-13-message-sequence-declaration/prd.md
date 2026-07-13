# 消息序列声明机制

## Goal

让 agent.json 的 contextPaths 声明每条注入在消息序列中的位置（position），替代硬编码的 `buildEntryAgentMessages` / `buildDelegatedAgentMessages` 骨架。使不同 agent、不同预设、不同模型能差异化消息序列结构，无需修改源码。PREFILL.md 纳入 contextPaths 体系（用 `position: "tail"` + `role: "assistant"` 替代独立文件机制）。

后续利用该机制还原原预设（三人逆行 v10 GLM 路径）的消息序列，解决思维链泄漏正文、字数不稳定、复述 system prompt 等问题。

## Background

### 问题来源

分析 storyteller 正文产出时发现三类问题：
1. **思维链泄漏正文**：glm-5.2 把思考过程放在 content stream 里，平台无原生 reasoning stream 识别，思考内容直接显示给玩家
2. **字数不稳定**：无字数执行机制，模型随时可以短回复结束
3. **复述 system prompt**：模型续写时延续 prefill 的"复述设定"模式（"资料到手""在场五人"），而非进入正文

根因在消息序列结构，不在单个 prompt 措辞。详见 `docs/active/message-sequence-architecture-analysis.md`。

### 原预设 vs Tsian 的结构性差异

原预设（SillyTavern）采用声明式组装：253 个 prompt 条目，每个有 role / injection_position / injection_depth / enabled，按 prompt_order 排列。用户可自由增删排序，无需改代码。

Tsian 的消息序列硬编码在 `apps/platform-web/src/agent-runtime/index.ts` 的 `buildEntryAgentMessages`（~line 815）和 `buildDelegatedAgentMessages`（~line 997）。骨架固定为：`system → history → workspace-context → turn-runtime → player-input → prefill`，无法按 agent/预设/模型差异化。

### 已确认的技术事实

- contextPaths 已支持 role（system/user/assistant），但位置固定在 workspace-context 区段
- PREFILL.md 是 agent 目录下的独立文件，硬编码为消息末尾 assistant 注入（`index.ts:897-899`）
- `locateHistorySpan`（`index.ts:318-357`）硬编码 `start = 1`（假设 history 紧随 system），扫描锚点前缀找 end
- `locateTaskInteractionSpan`（`index.ts:407-421`）从末尾向前扫描工具交互形状，不依赖框架消息顺序
- `replaceHistorySpan`（`index.ts:365-371`）splice 替换 history 段，依赖 span 边界正确
- 上下文压缩（narrative/task）在 turn 内可能触发，splice-replace history 段后继续工具循环
- 前端 InjectionMessage 支持 position（before-input/after-input），但这是前端注入机制，不是 agent 配置
- `buildAgentContextMessages_split`（`index.ts:695-709`）按 contextInjections 数组顺序逐条注入，保留声明顺序
- 缓存友好性：system + history 是最长稳定前缀，before-history 注入如果内容变化频繁会破坏缓存命中

## Requirements

### R1：contextPaths 支持 position 字段

每条 contextPath 条目可声明 position，控制注入到消息序列的哪个位置。

position 值集（4 个）：
- `before-history`：system prompt 之后、history 之前
- `workspace-context`（默认）：history 之后、turn-runtime 之前（现有行为）
- `after-input`：玩家输入之后、tail 之前
- `tail`：消息序列末尾（续写引导，替代 PREFILL.md）

不写 position 的条目默认 `workspace-context`，向后兼容。

同一 position 内多条条目按 contextPaths 数组声明顺序注入。

### R2：PREFILL.md 纳入 contextPaths 体系

- PREFILL.md 不再是独立机制，改用 contextPaths `{ position: "tail", role: "assistant" }` 声明
- 向后兼容：如果 agent 没有 `position: "tail"` 的 contextPath 但有 PREFILL.md 文件，自动转为 tail 注入
- 如果 agent 已有 `position: "tail"` 的 contextPath，忽略 PREFILL.md

### R3：locateHistorySpan 适配 before-history 注入

- 当前硬编码 `start = 1`（history 紧随 system）
- before-history 注入会在 system 和 history 之间插入消息
- 改为扫描：跳过 before-history 注入消息，找到 history 段的 start
- end 的扫描逻辑不变（继续找 workspace-context 锚点前缀）
- 无 before-history 注入时 start 仍 = 1（扫描跳过 0 条，行为不变）

### R4：delegated agent_call 路径同步改造

- `buildDelegatedAgentMessages` 同样支持 before-history / after-input / tail 注入
- delegated 路径的固定层（调用方信息、调用请求）不动
- delegated agent 如果声明了 tail 注入也尊重（虽然不直接面向玩家，但续写引导可能有用）

### R5：storyteller 还原原预设消息序列

利用 position 字段配置 storyteller 的 contextPaths，还原原预设 GLM 路径：
- `before-history`（assistant）：越狱确认复述（原预设"开始淫趴"角色接受示范）
- `workspace-context`（默认）：现有 writing-styles.md / writing-rules.md / modules
- `after-input`（system）：COT 问题框架 + 输出格式硬模板
- `tail`（assistant）：起笔短句 + `<think>` 未闭合开标签（续写引导）

新增文件：
- `agents/storyteller/prefill-accept.md`：越狱确认复述内容（从现有 PREFILL.md 拆出）
- `agents/storyteller/cot-template.md`：COT 问题框架 + 输出格式模板（从原预设 GLM Core + 自由CoT 提取，适配 Tsian 的 `[[选项]]` 约定）

### R6：前端 InjectionMessage 与 contextPaths position 的共存顺序

现有两个注入来源：
- **contextPaths**（agent.json 配置）：agent 常驻上下文，新增 position 字段
- **InjectionMessage**（前端代码动态注入）：每轮运行时信息，已有 position（before-input / after-input）

当两者注入到同一位置区域时，顺序规则：
- **after-input 区域**：前端 InjectionMessage 在前，contextPaths `after-input` 在后。理由：前端注入是动态运行时信息（runtime 快照、场景信息），contextPaths after-input 是固定框架模板（COT 问题、输出格式），模板在后更贴近续写点
- **before-input 区域**：只有前端 InjectionMessage，无 contextPaths 对应（contextPaths 不注入 before-input）
- **tail**：只有 contextPaths，无前端 InjectionMessage 对应。tail 是消息序列绝对末尾

完整 after-input 区域顺序：
```
[player input]
[前端 afterInputInjection]   ← 前端动态注入（现有）
[contextPaths after-input]   ← agent 配置的 COT 框架/格式模板（新增）
[contextPaths tail]          ← agent 配置的续写引导（新增，绝对末尾）
```

### R7：UI 可视化编辑（后续工作项，不在本次范围）

消息序列编辑 UI 类似酒馆预设编辑器：可视化展示各层、拖拽 contextPath 条目在层间移动、实时预览。作为独立工作项后续实现，后端声明机制是 source of truth。

## Acceptance Criteria

- [ ] contextPaths 条目支持 position 字段，4 个合法值（before-history / workspace-context / after-input / tail），默认 workspace-context
- [ ] 不写 position 的现有 agent 配置消息序列与当前完全一致
- [ ] PREFILL.md 文件在无 tail contextPath 时自动兼容为 tail 注入
- [ ] 有 tail contextPath 时 PREFILL.md 被忽略
- [ ] before-history 注入正确出现在 system 和 history 之间
- [ ] after-input 注入正确出现在玩家输入之后
- [ ] tail 注入正确出现在消息序列末尾
- [ ] locateHistorySpan 在有/无 before-history 注入时都能正确计算 span
- [ ] 上下文压缩（narrative/task）在有 before-history 注入时正确 splice-replace history 段
- [ ] delegated agent_call 路径正确支持 position 注入
- [ ] storyteller 配置还原原预设 GLM 路径消息序列（before-history 越狱确认 + after-input COT 框架 + tail 续写引导）
- [ ] storyteller 正文产出不再泄漏思维链到正文（思考在 `<think>` 块内，正文在块外）
- [ ] storyteller 正文字数稳定在目标区间

## Out of Scope

- `{{lastusermessage}}` 宏——不允许玩家输入通过宏注入到任意 position。理由：(1) agent 模式有结构化分层（runtime injection / contextPaths / history），玩家输入作为独立 user 消息在固定位置是合理的；(2) 允许玩家输入被宏注入到任意地方会破坏稳定前缀缓存；(3) 不是所有酒馆预设都用此宏——TGbreak V3.1.2 等较新预设已回到标准 user 消息 + Regex 标签包裹方式，和 Tsian 兼容。三人逆行 v10 等老式预设需要改造迁移。
- Regex 脚本机制（给 user 消息加标签包裹，如 TGbreak 的 `<peip>` 包裹）——后续独立工作项
- UI 可视化编辑器（后续工作项）
- 其他 agent（stage-manager / researcher / world-architect）的消息序列定制（架构支持，但本次只配置 storyteller）
- 模型级 position 分支（如 GLM vs Claude 不同 tail 内容）——当前通过 agent 配置区分，不做模型自动分支
- text-protocol 路径的 stripThinkBlocks 改造（现有 think-block 剥离逻辑不变，依赖模型用 `<think>` 标签闭合）

## Open Questions

无。所有技术问题已在探索阶段确认，产品决策已与用户对齐。
