# Implementation outcome

## Delivered
- `providers/claude.ts`: one shared request-building policy for text/native and streaming/non-streaming calls. Adds system + latest cacheable assistant-block explicit prefixes alongside the existing automatic tail. At most three slots, preserving text, tool IDs/order and caller objects.
- Keeps narrative/context storage, Agent isolation, non-Claude request bodies, default TTL, switch-off behavior and protected custom fields unchanged. No extra model calls or compatibility retries.
- Updated the used caching spec and its index; explains why rebuilt narrative history needs actual prefix writes and why local prefix comparison is not live cache usage.
- User-approved cleanup: removed the obsolete, non-smoke `apps/platform-web/src/integration/character-header.test.ts` (previously recorded in `09-11-canon-driven-storytelling/follow-up.md`). Its old CharacterEntity fixture lacked required equipmentStatus. Formal smoke and other unrelated tests remain untouched; no production type or tsconfig exclusions were changed.

## Verification
- Temporary `tmp/claude-stable-cache.probe.test.ts`: **7 tests passed** via `node ./node_modules/vitest/vitest.mjs run tmp/claude-stable-cache.probe.test.ts --reporter=verbose --silent`.
  - Final HTTP bodies from all four real call entry points with mocked fetch (no live API).
  - Semantic content equality, input non-mutation, enabled/disabled/custom top-level controls, <=3 slots and protected custom keys.
  - Parallel tool_use/tool_result preservation, first turns, empty assistants, missing system and unchanged OpenAI serialization.
  - Real card Runtime with 16 historical turns: auto-only prior tail no longer matches after reconstruction; explicit prior history remains reachable. Interleaved stage-manager leaves identical storyteller requests identical. Also checked 25 tool rounds without needing to persist their protocol history.
- `npm run test:smoke:web`: **2 files, 13 tests passed**, including final run after cleanup.
- `npm run build:web`: **passed in full**, including vue-tsc and Vite, after removing the user-approved obsolete test. No temporary exclusions remain. Existing Rollup annotation/chunk-size/dynamic-import warnings are nonfatal.
- `git diff --check` for touched source/spec files: passed.

## Investigation detours resolved
- Initial prototype attempted to reconcile custom block-level cache markers. A probe showed that parseBrowserAiCustomRequestParams already forbids custom system/messages/tools. Removed the unused generic counting/merging code; two platform markers + automatic are inherently bounded.
- Initial full type-check failed only on the pre-existing header fixture. A temporary config excluding that file passed; after the user's cleanup request the obsolete test and exclusion config were removed and the normal build passed.
- Sandboxed Vite could transform source but could not unlink an existing dist asset (EPERM). Re-ran the standard build with approval outside the sandbox after verifying the dist target; successful.
- Temporary probe and exclusion config removed after use, per smoke-only retention policy.

## Limits / retrospective
The user explicitly cautioned that the upstream API is unstable. No attribution of actual misses to frontend inter-agent interference is warranted. This patch restores a structural opportunity for Claude prefix reuse; live savings/hit rate remain unmeasured and depend on minimum cache size, lookback, TTL, exact prefixes and upstream routing. No guessed percentages or provider/session-key compatibility changes were added. This is complete for the agreed code-only optimization and cleanup; live verification can use normal diagnostic usage records later.
