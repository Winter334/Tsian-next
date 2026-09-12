# Claude stable-prefix cache

## Request and scope
User asked to optimize the code-confirmed cache weakness, without attributing an unstable upstream API's behavior to the frontend. Explain the impact with provider-specific limits; do not invent a measured hit-rate improvement.

## Acceptance
- Preserve Agent/slot context isolation and compact narrative history. Do not replay tool histories, change prompts, or add speculative session/routing keys.
- When Claude prompt caching is enabled, write reusable prefixes independently of the changing current-turn tail: system prefix and most recent cacheable assistant-message boundary, plus existing automatic tail caching.
- Cover text/native and streaming/non-streaming through the shared Claude builder. Keep non-Claude requests unchanged.
- Disabling caching preserves previous uncached request shapes and advanced custom-parameter behavior. No cache-disabled retry or TTL change.
- Use at most two explicit breakpoints plus the automatic one. Preserve rejection of custom system/messages/tools and the existing custom top-level cache_control behavior.
- Use temporary deterministic request-boundary/runtime probes, build:web, and smoke:web. Report live provider hit rates as unverified.

## User-approved follow-up cleanup
Remove the obsolete character-header.test.ts UI-specific fixture that blocks type-checking after CharacterEntity gained required equipmentStatus. It is not part of the retained smoke gate. Do not delete unrelated tests or change production types/tsconfig to satisfy that stale fixture; rerun the standard build without exclusions.
