# novel AIRP skill/agent 文档中文化

Parent: `06-27-default-card-novel-reader-airp`

## Goal

把任务 A（06-29-novel-airp-schema-consolidation）与任务 B（06-29-novel-airp-maintenance-skill-refinement）改动/新增的 skill 与 agent 相关文档从英文/中英混杂改成中文内容，方便中文玩家阅读和魔改（修改 skill/agent 行为）。未在本会话改动过的文档不改（后续单独优化）。

## Background

默认小说卡的 skill 与 agent 文档面向玩家与作者阅读编辑，中文母语者更易理解与魔改。任务 A/B 改动/新增了一批文档，其中 SKILL.md、schema guide/reference、维护类 SKILL.md、retrieval/post-processing AGENT.md、playthrough README 等仍以英文为主，与已是中文的 opening-initialization SKILL.md / scenes README / relationships README / world-architect AGENT.md 不一致。

## Requirements

仅中文化本会话改动/新增的文档常量（`workspace-templates.ts` 字符串模板），不改未动过的文档：

- `R1` `MEMORY_MAINTENANCE_SKILL_MD`：中文化（任务 B 改过）。
- `R2` `WORLD_STATE_MAINTENANCE_SKILL_MD`：中文化（任务 A 改过 + 任务 B 补 scenes/relationships 说明）。
- `R3` `RESOLVE_ENTITIES_SKILL_MD`：中文化（任务 B 新增）。
- `R4` `NOVEL_AIRP_SCHEMA_GUIDE_MD`：中文化（任务 A 扩展为速查层）。
- `R5` `NOVEL_AIRP_SCHEMA_REFERENCE_MD`：中文化（任务 A 新增）。
- `R6` `save/playthrough/README.md`：中文化（任务 A 改过，中英混杂）。
- `R7` retrieval `AGENT.md`：中文化（任务 B 改过，新增英文工作流速查段落到原本中英混合文档）。
- `R8` post-processing `AGENT.md`：中文化（任务 A 改过，新增英文聚合层维护行）。
- `R9` post-processing `agent.json` summary：中文化（任务 A 改过 summary）。

不改：openning-initialization SKILL.md（已是中文）、scenes README / relationships README（已是中文）、entity-reader SKILL.md（未动）、tsian-framework-knowledge.md（未动）、master AGENT.md/SOUL.md/agent.json（未动）、world-architect AGENT.md（已中文，未增英文）、各 save/* 未改 README、docs/README.md。

## Acceptance Criteria

- [ ] R1-R9 文档主体改为中文，保留代码块/front matter 字段名/路径/JSON 字段名等不翻译（技术标识符保持英文）。
- [ ] `npm run build:web` 通过。
- [ ] 拼写校对：无中英混杂残留（除技术标识符）。

## Out of Scope

- 未在本会话改动的文档中文化（后续单独任务）。
- 改动任何非文档逻辑（脚本 JS、agent.json 结构字段）。

## Notes

- 翻译原则：说明性散文中文化；代码块/JSON/path/字段名/front matter 元字段保持英文（这些是技术标识符，中文化会破坏解析或让模型困惑）。
- 编辑面集中在 `workspace-templates.ts` 字符串模板，低风险。