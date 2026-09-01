# 实施记录与验收对照

提交：`209275d0` perf(card): cut stage-manager post-turn maintenance round-trips（master，5 个文件）
spec 沉淀：`airp-data-capability-design-principles.md` 原则 8 补「注入内容不注入索引」判据；
`prompt-self-contained-and-tone.md` 新增第三类错误「格式串只给占位符不给正样本」。

## 基线（改动前）

2026-08-28 对沉浸阅读器卡片玩家回合 #1 的一次真实回合后维护全链路分析：

| 指标 | 基线值 |
|---|---|
| LLM 往返轮次 | 29 |
| 工具调用次数 | 约 70 |
| 失败或空结果 | 13 |
| 有效信息量 | 约 8k token |
| 累计 input token | 约 100 万 |
| 单次最大浪费 | 读 `tools/text_edit/run.js` 全文 19651 字符，随后在 7 轮里重复发送 |

失败明细：`seeds.md` 写入失败 2 次（R1）、turn 文件 read 失败 2 次 + list 找路 3 轮（R2）、
`commit_turn_recall` 失败 2 次（R5）、实体与关系全量 `list` + `read` 14 次（其中 8 次与本回合无关，R6）。

## 改动落点

| 需求 | 文件 | 内容 |
|---|---|---|
| R1 | `tools/text_edit/run.js` | `validateMemoryLines` 两处 `fail` → `continue`；新增 `collectMemoryStats` 与 `trace.memory` |
| R2 | `skills/回合后维护/workspace-map.md` | turn 位数注解修正为 6 位 + 编号语义；新增「ref → 文件路径」小节 |
| R3 | `agents/stage-manager/agent.json` | `contextPaths` 追加 4 条（`current.md` prelude；`runtime.json` / `records.md` / `seeds.md` runtime） |
| R4 | `tools/text_edit/run.js` | `MEMORY_FORMAT_HINT` 常量；`assertMemoryOperationLines` 的 `fail` 带 `expectedFormat` / `example` / `received` |
| R5 | `skills/回合后维护/workspace-map.md` | 新增「commit_turn_recall 字段」小节（15 枚举 + 字段类型与上限） |
| R6 | `skills/回合后维护/SKILL.md`、`AGENT.md` | 第 3 步改为首选路径指令 + 回退许可与回退说明义务；第 4 步限定为非实体资料；AGENT.md 增补工具偏好条目 |

平台侧 `apps/` 与 `packages/` diff 为空。

## 离线检查结果（已完成）

以 mock `tsian.workspace` 驱动 `text_edit/run.js`，30 项断言全部通过：

- R1：含说明行的 `seeds.md` 直接 append 一次成功，说明行保持原样；`trace.memory[0].skippedLines === 1` 如实暴露脏行
- R4：格式错误返回 `expectedFormat` + `example` + `received`，`message` 明确指向 `edit line N`，
  `retryable` 与 `correction.focus` 未变，文件未被写入
- 回归：records 序号连续性、records 重复检测、seeds 同名追加拦截、seeds `resolved → planted` 逆向迁移拦截，四项强度均未下降
- `closedCount` / `entryCount` / `charCount` 数值正确；非 memory 文件不产出 `memory` 字段

## 活体检查结果（5.3，已完成）

2026-08-28 重新打包卡片后，以同一份 `turn-000001` 重跑回合后维护，
请求 dump 见 `tmp/请求.txt`（Gemini 3.7 Flash，23 条消息，请求总字符 33,401）。

| 指标 | 基线 | 本轮 | 降幅 |
|---|---|---|---|
| LLM 往返轮次 | 29 | 8 | −72% |
| 工具调用次数 | 约 70 | 10 | −86% |
| 失败或空结果 | 13 | 1 | −92% |

轮次分布：`use_skill` → 并行 4 个读取（turn / frontier / scene / `query_entities`）→
`read_entities` → `json_edit`（一批 5 个目标全 applied）→ `text_edit` ×2 → `commit_turn_recall`。

| 观察项 | 期望 | 实测 |
|---|---|---|
| 流程第 1 步的 read / list | 0 | **0** ✅ |
| 注入位置 | `current.md` prelude、其余三个 runtime | 与配置一致，均带 `<!-- source: -->` 标记 ✅ |
| turn 文件路径 | 一次读对 | 一次命中，零 list ✅ |
| ref → path 推导 | 从 `activeSceneRefs` 推出场景路径 | 直读 `save/scenes/卧房重逢.json` 命中 ✅ |
| `commit_turn_recall` | 一次成功 | 一次成功，`事件类型` 数组与枚举全对 ✅ |
| 实体 / 关系读取 | 走专用工具 | `query_entities`（9 条摘要 2.1k 字符）→ `read_entities`（只读 4 个相关角色）；无关实体零读取 ✅ |
| 总往返轮次 | 显著低于 29 | 8 ✅ |

维护质量未因读取减少而下降：`json_edit` 一批提交 runtime + scene + 三个角色的
`goals` / `status`，5 个目标全部 applied，零失败。

**R1 本轮未被触发。** Agent 判断本回合无明确伏笔，未写 `seeds.md`；注入内容显示存档中
那行说明行仍在。R1 由离线检查覆盖，活体验证待下次真实写入 seeds 时确认。

### 唯一失败的根因与后续修补

`text_edit` 第一次提交 `- [1] <scene> 关键词: ...` 失败——Agent 把格式串里的尖括号占位符
`<recall|scene|npc_action>` 当字面语法照抄了。R4 的错误返回带 `expectedFormat` + `example`
+ `received`，下一轮**一次改对**（基线中同类失败引发约 15 轮探索）。

根因是格式串表示法本身：注入的 `records.md` 模板、`workspace-map.md`、`SKILL.md`、
`expectedFormat` 四处清一色用尖括号，唯一的正样本只存在于报错后的 `example` 里，
Agent 必须先撞一次才能看到。

已在 `SKILL.md` 的 memory 小节与 `workspace-map.md` 的 `save/memory` 小节各补一条
「尖括号只标示可选值，写入时不带尖括号」+ 正确示例。该修补未再跑活体验证
（主人决定补完收工），未生效也仅退回本轮的 1 次自愈失败，风险为零。

## 附带发现（未处理）

`agents/stage-manager/tools/read_maintenance_context/run.js` 文件仍存在于卡片工作区，
但 `agent.json` 的 `tools.enabled` 未声明它，实际不可调用。属 `0a38b969` 重构的清理遗漏，
不在本任务范围（本任务非目标明确「不恢复 `read_maintenance_context`」），记录备查。
