# Anthropic Prompt Caching Research

Checked: 2026-08-15

## Official API behavior

Source: https://platform.claude.com/docs/en/build-with-claude/prompt-caching

- Anthropic supports top-level `cache_control: { "type": "ephemeral" }` to enable automatic prompt caching.
- The automatic mode is intended for multi-turn conversations and moves the managed cache breakpoint as history grows.
- Explicit cache breakpoints on tools, system blocks, or message content remain available for precise control when sections change at different frequencies.
- Automatic and explicit breakpoints can be combined, but the automatic breakpoint consumes one available breakpoint slot.
- Default ephemeral TTL is five minutes; one-hour TTL and explicit breakpoint policy are separate choices.
- Server tool results receive automatic breakpoints in later agentic-loop iterations only after prompt caching has been enabled by at least one cache-control marker.

## Repository evidence

- Before this task, `apps/platform-web/src/runtime-host/ai/providers/claude.ts` built Claude bodies without `cache_control`.
- `apps/platform-web/src/runtime-host/ai/providers/shared.ts` already reads `cache_read_input_tokens` and `cache_creation_input_tokens`; this is observability, not request-side enablement.
- `apps/platform-web/src/runtime-host/ai/providers/claude.ts` routes text, native and stream requests through `buildClaudeRequestBody`, so one adapter-boundary switch covers all call styles.
- `.trellis/spec/platform-web/frontend/type-safety.md` requires unknown persisted values to be normalized at the runtime boundary; for the new default-on boolean, missing values become enabled while explicit `false` remains disabled.
- `.trellis/tasks/archive/2026-06/06-30-workspace-context-cache-split/prd.md` explicitly deferred Claude `cache_control` to a later provider-specific task.

## Decision for this task

Use top-level automatic caching by default with a model-level off switch. Do not add explicit block markers, TTL selection, model-name capability tables, provider probing, or automatic retry fallback in this task.
