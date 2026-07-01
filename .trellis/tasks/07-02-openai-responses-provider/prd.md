# OpenAI Responses API provider support

## Goal

新增 OpenAI Responses API 提供商类型（显示名 OpenAI Responses），完整支持 /responses 协议的文本与原生工具调用、流式输出、usage/错误解析和调试记录；解决仅支持 Responses 格式的中转站在 Chat Completions tools 格式下报 tools[].name 为空的问题。

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
