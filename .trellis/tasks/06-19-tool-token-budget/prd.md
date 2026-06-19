# 限制机制改造（token 预算）

## Goal

去maxToolRoundsPerAgent硬轮次限制，改单次请求上下文token预算（默认256k，超限触发压缩）；温和兜底报错不裸抛助手不可用。依赖子1（工具循环形态变了）。

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
