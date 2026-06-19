# 工具与 skill 解耦重构

## Goal

skill 回归按需触发脚本形态：skill_load→use_skill（B方案，模型声明意图框架下轮注入skill全文+注册action）；action_call→run_script（直接执行browser_script不需预load）；移除builtin/platform_action executor；registry阶段解析action声明。

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
