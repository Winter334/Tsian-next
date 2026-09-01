# Design: 拆分 platform-host 入口聚合文件

## Split Shape

候选模块：

```text
apps/platform-web/src/platform-host/
  index.ts              # bridge assembly / barrel
  host-state.ts          # singleton readiness/active state if needed
  workspace-actions.ts   # action normalization/execution glue
  runtime-traces.ts      # trace path/write helpers
  resource-queries.ts    # query resource handlers
  ai-invocation.ts       # model-call injection/invocation queue glue
```

优先复用现有 focused modules，避免创建与已有模块职责重叠的新文件。

## Compatibility

- `playFrontendBridge` shape 不变。
- Event ordering 不变。
- Active save/checkpoint lifecycle 不变。
- Runtime trace path and metadata 不变。

## Rollback

- Baseline branch: `backup/split-platform-host-index-pre-split`。
- Patch checkpoints per host responsibility seam.
