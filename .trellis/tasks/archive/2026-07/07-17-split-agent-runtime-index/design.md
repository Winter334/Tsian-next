# Design: 收敛 Agent Runtime 主编排文件

## Split Shape

候选模块：

```text
apps/platform-web/src/agent-runtime/orchestration/
  history.ts
  context-injections.ts
  message-formatting.ts
  skill-activation.ts
  loop-state.ts
```

`agent-runtime/index.ts` 保留主入口、turn orchestration、public runtime API 和高层 glue。

## Risk Controls

- 不移动核心 turn loop 直到 helper seams 已验证。
- 不改变 message skeleton positions。
- 不通过 barrel 反向导入 helper，避免 ESM 初始化顺序问题。

## Rollback

- Baseline branch: `backup/split-agent-runtime-index-pre-split`。
- Patch checkpoints per helper seam.
