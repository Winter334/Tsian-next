# 场记维护工具效率优化 Implementation Plan

## Phase 1 — Core shared edit tools

1. Add `cards/沉浸阅读器.tsian-card/workspace/tools/json_edit/tool.json`.
   - Keep description short and example-driven.
   - Expose `target`, `create`, `set`, `append`, `upsert`, `remove`, `unset`, `ops`.
2. Add `cards/沉浸阅读器.tsian-card/workspace/tools/json_edit/run.js`.
   - Implement target resolution.
   - Implement dot-path parser with dangerous key checks.
   - Implement `create`, `set`, `append`, `upsert`, `remove`, `unset` semantics.
   - Implement light AIRP invariant checks.
   - Implement sequential `ops`, partial failure response, expectedContent write.
   - Return compact results and short validation errors.
3. Add `cards/沉浸阅读器.tsian-card/workspace/tools/text_edit/tool.json`.
   - Expose `target`, `create`, `append`, `replace`, `remove`, `ops`.
4. Add `cards/沉浸阅读器.tsian-card/workspace/tools/text_edit/run.js`.
   - Implement line append/replace/remove.
   - Enforce exact-one-line match for replace/remove.
   - Implement explicit create only.
   - Implement sequential `ops`, partial failure response, expectedContent write.
5. Remove or stop exposing `cards/沉浸阅读器.tsian-card/workspace/tools/update_entity`.
   - Final agent configs and Skill docs must not mention `update_entity`.
   - Code may be consulted during implementation, but old tool should not remain as a visible option.

## Phase 2 — Stage-manager read/context and prompts

6. Update `cards/沉浸阅读器.tsian-card/workspace/agents/stage-manager/tools/read_maintenance_context/run.js`.
   - Return relevant JSON documents directly instead of schema-specific field projections.
   - Include runtime, active scenes, present entities, protagonist entity, relevant relationship files, records tail, seeds lines/content, optional timeline, scene cleanup candidates.
   - Keep no complex compact strategy in v1.
7. Update `cards/沉浸阅读器.tsian-card/workspace/agents/stage-manager/tools/read_maintenance_context/tool.json` description to match navigation-bundle behavior.
8. Update `cards/沉浸阅读器.tsian-card/workspace/agents/stage-manager/tools/commit_turn_recall/run.js` if needed for short expected errors.
9. Update `cards/沉浸阅读器.tsian-card/workspace/agents/stage-manager/agent.json`.
   - Remove long/dynamic contextPaths.
   - Enable `json_edit` and `text_edit`.
   - Remove `update_entity`.
   - Keep platform workspace tools as fallback.
10. Update `cards/沉浸阅读器.tsian-card/workspace/agents/stage-manager/AGENT.md` only if needed to keep standing principles short and aligned.
11. Update `cards/沉浸阅读器.tsian-card/workspace/agents/stage-manager/skills/回合后维护/SKILL.md`.
   - Replace `update_entity` guidance with `json_edit`/`text_edit`.
   - Keep first-step `read_maintenance_context` requirement.
   - Add compact examples.
   - Add final summary domain format.
   - Make guidance self-contained and action-oriented.
12. Update `cards/沉浸阅读器.tsian-card/workspace/agents/stage-manager/skills/schema演进检查/SKILL.md`.
   - Clarify guide/current schema/changelog are read on demand when schema evolution is triggered.

## Phase 3 — World-architect integration

13. Update `cards/沉浸阅读器.tsian-card/workspace/agents/world-architect/agent.json`.
   - Enable shared `json_edit` and `text_edit`.
14. Update world-architect Skills:
   - `agents/world-architect/skills/开局建模/SKILL.md`
   - `agents/world-architect/skills/frontier推进/SKILL.md`
   - Add positive guidance: commit scripts are preferred for main submissions because they provide cross-file validation; `json_edit`/`text_edit` are for local fixes and documentation maintenance.

## Phase 4 — Validation

15. Run targeted syntax checks for new browser scripts.
   - Example: `node --check <run.js>` if compatible with script style.
16. Search for stale `update_entity` references.
   - Ensure final AI-facing docs/configs do not recommend or enable it.
17. Manually inspect tool JSON schemas for short descriptions and valid required fields.
18. Use a representative maintenance scenario or fixture if available to validate:
   - `json_edit` runtime set.
   - `json_edit` entity append/upsert.
   - `json_edit` relationship upsert.
   - `text_edit` records append.
   - `text_edit` seeds replace failure on 0 match / multi match.
   - `read_maintenance_context` returns enough data without supplemental runtime/entity/scene/relationship reads.
19. Review one generated stage-manager prompt/tool log if possible.
   - Expected: no `UPDATE_ENTITY_INVALID_REF`, no long stack, fewer supplemental reads, final summary by domain.

## Risk and Rollback Points

- Tool scripts are card workspace files. If `json_edit`/`text_edit` behavior is wrong, fix the new tool directly; do not restore `update_entity` as an AI-facing option unless explicitly decided.
- If contextPaths slimming removes needed standing knowledge, prefer adding concise rules to Skill over restoring long dynamic files.
- If `read_maintenance_context` returns too much in future saves, add a simple size guard as a later task.

## Validation Commands

Use available project commands as appropriate after implementation. At minimum:

```bash
node --check cards/沉浸阅读器.tsian-card/workspace/tools/json_edit/run.js
node --check cards/沉浸阅读器.tsian-card/workspace/tools/text_edit/run.js
node --check cards/沉浸阅读器.tsian-card/workspace/agents/stage-manager/tools/read_maintenance_context/run.js
node --check cards/沉浸阅读器.tsian-card/workspace/agents/stage-manager/tools/commit_turn_recall/run.js
rg -n "update_entity|更新实体" cards/沉浸阅读器.tsian-card/workspace
```

If the card runtime provides a tool execution harness, run the representative tool inputs listed in Phase 4.
