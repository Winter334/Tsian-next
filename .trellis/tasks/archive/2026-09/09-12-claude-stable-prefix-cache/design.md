# Design

## Evidence
The preceding read-only probe ran the real card Runtime with a mocked model. A -> B -> identical A yielded identical Claude/OpenAI bodies, with distinct Agent system/tools. A narrative turn stores raw player input and final narrative, not the original turn-runtime/input/framing envelope. Rebuilding the following turn removes the previous final automatic cache-write prefix even without maintenance. This is a structural observation, not a measured upstream cache miss.

Claude documentation says writes happen only at breakpoints; automatic lookup does not create missing stable-prefix entries. Automatic caching reserves one of four slots; lookup checks up to 20 block positions. Source: https://platform.claude.com/docs/en/build-with-claude/prompt-caching (read 2026-09-12).

## Bounded implementation
Keep policy inside providers/claude.ts's shared request builder. No runtime/SDK/context persistence changes. Retain top-level ephemeral automatic caching for tool rounds. Add an explicit marker at the latest cacheable assistant block (text or tool_use), plus the end of the system content. At a new narrative turn the assistant boundary is the stored history end; on later tool rounds it advances with the conversation. Next turn's lookback can find the previously written history boundary instead of depending on the discarded current-input envelope. System provides a reusable base when no history exists or history is compressed.

Use fresh provider objects/arrays; do not mutate caller messages, tool schemas or config. Preserve text and block order. Two generated explicit markers plus automatic caching use at most three slots. Existing parseBrowserAiCustomRequestParams rejects custom system/messages/tools, so user block-level markers are not a possible input. Keep that actual boundary instead of adding a generic marker-count/merge abstraction. The initial prototype assumed custom block markers were allowed; a focused probe exposed the protected-key contract, and the unnecessary merging logic was removed before delivery.

## Alternatives and limits
- Full protocol replay would change narrative behavior/storage and grow context: rejected.
- Runtime-to-provider cache-hint plumbing is unnecessary for this local improvement; the assistant boundary already exists in each provider request.
- Adding cache routing keys cannot repair rewritten prefixes and is provider/proxy-specific: deferred absent evidence.
- Default TTL, model minimum-token thresholds, provider eviction/routing, and actual cache usage are unchanged. No claim that all preserved characters/tokens will be cached.
- Replaces the old auto-only scope restriction based on demonstrated message-shape incompatibility and this user-approved optimization, not claimed live usage evidence.
