# Design: 拆分 Agent Runtime workspace tools

## Split Shape

```text
apps/platform-web/src/agent-runtime/workspace-tools/
  index.ts
  types.ts
  parsing.ts
  tracing.ts
  observations.ts
  action-executors.ts
  agent-call.ts
  skill-actions.ts
  shared.ts
```

`workspace-tools.ts` remains a compatibility facade if consumers import it directly.

## Boundaries

- `parsing.ts`: text/native tool call parsing and argument normalization.
- `tracing.ts`: trace emit payload construction only.
- `observations.ts`: runtime observation formatting/summarization.
- `action-executors.ts`: controlled executor policy and execution metadata.
- `agent-call.ts`: runtime agent call behavior and metadata.
- `skill-actions.ts`: skill action fence parsing/execution integration.

## Rollback

- Baseline branch: `backup/split-agent-runtime-workspace-tools-pre-split`。
- Patch checkpoints per module seam.
