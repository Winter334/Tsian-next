# AI Provider Caching

Use this guide when changing Claude request construction, its model-level caching switch, or cache diagnostics. The policy lives in `src/runtime-host/ai/providers/claude.ts`; the shared `buildClaudeRequestBody` covers text/native and streaming/non-streaming calls.

## Why automatic tail caching is not enough here

Narrative context stores player input and final prose, not the original current-turn envelope or full tool protocol. The next turn rebuilds that history. Earlier history can remain identical, but the previous request's final prefix usually does not: turn metadata, input labels, framing and tool messages are no longer there in the same form.

Claude only writes cache entries at breakpoints. Its automatic lookback searches previously written prefixes; it does not create an entry for an arbitrary stable interior prefix. Consequently, preserving old prose alone does not guarantee reuse with an automatic tail-only breakpoint. Do not restore full tool histories or change narrative semantics merely to make the request append-only.

## Request policy

When `BrowserClaudeModelParameters.promptCachingEnabled` is true, the common builder adds:

- Top-level `cache_control: { type: "ephemeral" }` for automatic tail caching within the current conversation/tool loop.
- An explicit ephemeral breakpoint on the system text block, providing a base prefix for first turns and rewritten/compressed history.
- An explicit ephemeral breakpoint on the last cacheable block of the most recent assistant message. At narrative turn start this is the stored history end; during tool rounds it advances to the latest assistant text/tool-use boundary. Mark the last parallel `tool_use`, not an earlier text block, and never mark thinking blocks.

The two explicit breakpoints plus automatic caching use at most three of Claude's four slots. Custom request parameters cannot override `system`, `messages`, or `tools` (enforced by `parseBrowserAiCustomRequestParams`), so there is no second source of block-level markers to reconcile. Keep that protection rather than adding a speculative breakpoint-merging layer.

Cache markers must not mutate caller messages/config/tool schemas, change text or block ordering, or insert model-visible instructions. Claude's `system`/assistant string shorthand becomes text-block arrays only where a marker is needed. Non-Claude serialization, context storage, Agent isolation, and request routing are unchanged.

## Configuration and compatibility

- New/missing Claude settings normalize enabled; explicit false remains disabled. Both settings surfaces use the same field.
- Disabling the switch omits all platform-added cache controls and preserves the uncached string/block shapes.
- Keep the existing custom-parameter merge: enabled platform settings own top-level `cache_control`; when disabled, advanced custom JSON can still supply that top-level field.
- Do not retry rejected requests with caching removed. Such a retry can add cost, latency or Tool side effects; the model switch is the explicit compatibility escape hatch.
- Do not silently add a longer TTL, provider capability probing, or random/per-invocation routing keys. This fix concerns prefix writes, not upstream session affinity.

## Evidence and limits

No code change can guarantee cache hits. Prefix/model/tool changes, history compression, the provider's minimum cache length, lookback limits, expiration and upstream routing still apply. A fresh historical prefix is generally written at one turn's start and becomes reusable in a later turn; the latest reconstructed turn is not magically fully cached.

Use only provider-reported `cache_read_input_tokens` -> `cached` and `cache_creation_input_tokens` -> `cacheCreation` for diagnostics. A deterministic prefix comparison establishes a structural opportunity for reuse, not a measured hit or savings percentage. Agent-specific local contexts and a missing explicit routing key do not by themselves prove cache interference.

## Verification

For adapter changes, inspect final HTTP bodies across all four call styles; check switch-off/custom top-level behavior, input non-mutation, parallel tool IDs/results, bounded marker count, first-turn/no-history behavior, and old/new cross-turn prefix reachability. Use temporary explicit-path probes under the smoke-only policy, plus `npm run build:web` and `npm run test:smoke:web`; disclose any unrelated worktree failures instead of changing other tasks' files.

A live check needs prompts above the actual model's minimum threshold and provider-reported creation/read usage on consecutive turns. Compare like-for-like requests from the same Agent/model and inspect timing; do not mix maintenance requests into a narrative hit-rate comparison.

References: [Claude prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching); task `09-12-claude-stable-prefix-cache` records the offline evidence and remaining live uncertainty.
