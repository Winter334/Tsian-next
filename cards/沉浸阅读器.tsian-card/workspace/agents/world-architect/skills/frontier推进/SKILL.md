---
name: frontier推进
title: frontier推进
description: 推进 source frontier，读取下一段源章节窗口，识别剧情节点建立 source 锚点，抽取最小素材增量。
triggers:
  - 推进 source frontier 时
appliesTo:
  - world-architect
---

# frontier推进

推进 source frontier：读下一段源章节窗口，识别剧情节点建立 source 锚点，抽取最小素材增量。推进只扩展素材边界。

## 推进流程

1. `read_frontier_window` → 读当前 frontier.json 的 sourceWindow，计算下一段最多 15 章窗口，通过 source reader 读取对应章节，返回章节文本 + frontier 状态。
2. 识别剧情节点 + 抽取最小素材增量。
3. `commit_frontier_materials` → 校验并写入 entities/relationships/schema patches 增量。
4. `commit_frontier_state` → 校验 order 递增、sourceWindow 顺序推进、timeline 锚点 chapter 在窗口内，写入 frontier.json（合并新 source 锚点到 timeline 数组）。

素材增量提交成功后才推进 frontier 状态。若素材提交失败，不推进 sourceWindow/extractedThrough/timeline。无可抽取素材时也需通过空 materials 提交明确完成后再推进 frontier。

主流程优先使用本 Skill 的 commit_* action，以获得 sourceWindow、timeline、entity 与 relationship 的跨文件校验。`json_edit` / `text_edit` 适合用于局部修正、schema patch 或文档维护。

## 抽取什么

- 新登场角色（entity）：identity/appearance/attributes（按境界参照 schema guide 示例刻度尺填写），不抽 sourceRefs/origin。
- 角色关系（relationship）：仅 character↔character，不抽地点/组织/物品关联。
- schema 增量：仅在发现需要新字段/结构时写 pending patch。

## 不抽取什么

- 不抽场景（scene 由 stage-manager 维护）。
- 不抽 player 锚点（stage-manager 维护）。
- 不抽剧情摘要/阶段目标/创作指导。
- 不全量提取窗口内所有内容——只抽"与当前阶段可能相关的最小增量"。

## source 锚点建立规范

- 识别剧情节点（不是每章都建，只在有显著事件变化的节点建）。
- 原文有明确时间词 → 直接用。
- 原文无时间词 → 从剧情推断估计时间（如"赶路翻三座山"→ 估"数周后"→ 按当前时间线推算）。不允许因"读不到时间词"而跳过锚点建立——time 可为估计值，order 照常递增。
- label 一句话客观标签，不是剧情摘要。
- order 赋值：严格大于现有最后一个 source 锚点的 order，连续递增。
- 锚点的 chapter 必须落在你提交的 sourceWindow 范围内（脚本会校验）。

## 窗口与节点

- 单次推进最多读 15 章（硬上限，防止大节点一次吞太多章节）。
- 语义目标：覆盖至少 1-2 个剧情节点后即可提交 sourceWindow.end，不必读到上限。
- 上限内读不到 2 个完整节点时，提交到上限章节，就已有显著变化点建锚点，剩余节点延续到下次推进。
- sourceWindow.end 由你语义决定，可小于实际读到的最后一章。
- 只对不超出 sourceWindow.end 的章节建 source 锚点和抽取实体；超出 end 的章节仅供判断"是否还有下一个剧情节点"，不从中抽实体、不建锚点（spoiler-safe）。
- 窗口还受总字符数兜底（约 12 万字），长章节小说实际读到的章数可能少于 15——以 read_frontier_window 返回的 window.end 为准。
- 过去章节不倒回搜索。窗口外不读。

## 可用脚本（tsian-actions）

用 `run_script` 执行下列 browser_script action；脚本校验输入并写入对应落点，失败时返回 code/message 供你修正重试。

```json tsian-actions
[
  {
    "name": "read_frontier_window",
    "description": "读 frontier.json 当前 sourceWindow，计算下一段最多 15 章窗口，通过 source reader 读取对应章节文本，返回章节文本与 frontier 状态。只读不写。",
    "inputSchema": { "type": "object", "properties": {} },
    "outputSchema": { "type": "object" },
    "executor": { "type": "browser_script", "path": "scripts/read-frontier-window.js", "timeoutMs": 15000, "helpers": ["_common.js"] }
  },
  {
    "name": "commit_frontier_materials",
    "description": "校验 entities/relationships/schemaPatches 增量并写入 save/entities/、save/relationships/、save/schema/patches/pending/。校验 entity ref 格式、relationship subject/to 为 character:<localId>。",
    "inputSchema": { "type": "object", "properties": { "entities": { "type": "array" }, "relationships": { "type": "array" }, "schemaPatches": { "type": "array" } } },
    "outputSchema": { "type": "object" },
    "executor": { "type": "browser_script", "path": "scripts/commit-frontier-materials.js", "timeoutMs": 15000, "helpers": ["_common.js", "_validation.js"] }
  },
  {
    "name": "commit_frontier_state",
    "description": "校验 order 严格大于现有最后 source 锚点 order、sourceWindow 顺序推进、timeline 锚点 chapter 在新窗口内，写入 frontier.json（合并新 source 锚点到 timeline 数组）。",
    "inputSchema": { "type": "object", "required": ["sourceWindow", "timelineAnchors"], "properties": { "sourceWindow": { "type": "object" }, "extractedThrough": { "type": "string" }, "timelineAnchors": { "type": "array" } } },
    "outputSchema": { "type": "object" },
    "executor": { "type": "browser_script", "path": "scripts/commit-frontier-state.js", "timeoutMs": 10000, "helpers": ["_common.js", "_validation.js"] }
  }
]
```

## 重试策略

脚本返回校验错误时按 code/message 修正后重试，不放弃。

## spoiler-safe

只使用窗口中读到的内容。不推断、不剧透窗口外的未来剧情。
