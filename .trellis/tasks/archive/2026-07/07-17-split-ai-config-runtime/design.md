# Design: 拆分 AI config 与 runtime

## Split Shape

Config side:

```text
apps/platform-web/src/config/ai/
  index.ts
  types.ts
  defaults.ts
  normalize.ts
  providers.ts
  model-fetch.ts
```

Runtime side:

```text
apps/platform-web/src/runtime-host/ai/
  index.ts
  types.ts
  content.ts
  debug-records.ts
  fetch.ts
  tool-calls.ts
  probes.ts
  providers/
    openai-chat.ts
    openai-responses.ts
    claude.ts
    gemini.ts
    deepseek.ts
```

Original files may remain facades to preserve import paths.

## Compatibility

Provider request builders must be moved without semantic edits. If a request body field order changes but JSON value is equivalent, record it; if value changes, stop for review.

## Rollback

- Baseline branch: `backup/split-ai-config-runtime-pre-split`。
- Patch checkpoints: config normalization, debug records, each provider, probes/tool-calls.
