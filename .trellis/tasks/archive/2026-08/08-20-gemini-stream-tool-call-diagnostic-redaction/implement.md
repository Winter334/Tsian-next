# Implementation Plan: Gemini 流式工具调用与诊断脱敏修复

## Pre-implementation Context

- `.trellis/spec/platform-web/frontend/state-management.md`
- `.trellis/spec/platform-web/frontend/type-safety.md`
- `.trellis/spec/platform-web/frontend/quality-guidelines.md`
- `.trellis/spec/platform-web/storage/diagnostics.md`
- 本任务 `prd.md` 与 `design.md`

## Steps

1. **Fix Native stream classification**
   - In `apps/platform-web/src/runtime-host/ai/calls.ts`, make non-empty finalized tool calls override adapter finish reason.
   - Preserve ordinary no-tool `stop`, usage, trace, partial-response and SSE error behavior.

2. **Harden the Native Agent loop**
   - In `apps/platform-web/src/agent-runtime/index.ts`, continue to tool execution whenever parsed native tool calls are non-empty, even if finish reason says `stop`.
   - Preserve `onRoundEnd`, timeline collection, observation correlation and multi-tool ordering.

3. **Close Gemini diagnostic credential gaps**
   - Add normalized `xgoogapikey` to `SECRET_KEYS` in `apps/platform-web/src/storage/diagnostic-records.ts`.
   - Add `x-goog-api-key` to export credential-text header redaction in `apps/platform-web/src/platform-host/diagnostic-bundle.ts`.
   - Do not add a migration, cleanup pass, DB version, or UI-specific masking branch.

4. **Create and run task-scoped temporary regression tests**
   - Create two temporary focused Vitest files for Gemini streaming and diagnostic sanitization; run each explicitly by path.
   - Use an opaque fake Key without known provider prefixes.
   - Cover `functionCall + STOP -> tool execution -> functionResponse -> final text`.
   - Assert persisted diagnostics and generated export files exclude structured and text-form fake credentials.
   - After the focused tests pass, delete both temporary files. Do not add them to root scripts or existing smoke files.

5. **Update the permanent test-maintenance contract**
   - Update `.trellis/spec/platform-web/frontend/quality-guidelines.md` to permit task-scoped temporary focused tests that are run explicitly and removed before final commit.
   - State that permanent smoke tests remain small project-operability gates and should not absorb one-off bug-specific assertions by default.
   - Preserve explicit permanent test admission and the existing authoritative smoke inventory.

6. **Review invariants**
   - Search all `resolvedFinish`, Native loop terminal checks, `SECRET_KEYS`, and credential-text patterns for consistency.
   - Confirm no contracts, DB schema, provider config, base URL, or historical records changed.

7. **Validation**
   - Run each temporary test explicitly before deleting it and record the passing result in the task/session handoff.
   - `npm run build:contracts`
   - `npm run test:smoke:web`
   - `npm run build:web`
   - `git diff --check`
   - Inspect the generated/test bundle strings to confirm the opaque fake Key is absent and ordinary content remains.
   - Confirm `git status`/`rg --files` show no temporary tests and `package.json` test scripts are unchanged.

## Risk and Rollback Points

- After step 2: verify tool calls, not provider finish strings, are the only reason the Native loop continues.
- After step 3: verify credential matching is exact enough not to remove token-count fields.
- After step 4: do not delete temporary tests until both focused checks pass; ensure deletion removes only task-created files.
- After step 5: verify the spec permits temporary tests without weakening explicit permanent test admission.
- The runtime and diagnostic changes are independent and can be reverted separately if one validation path fails.
