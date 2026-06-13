# Implementation Plan

## Checklist

1. [x] Refresh pre-development specs with `trellis-before-dev`.
2. [x] Update `apps/platform-web/src/agent-runtime/workspace-tools.ts`.
   - Import shared platform action contract types from `@tsian/contracts`.
   - Extend runtime tool execution context with optional `runPlatformAction`.
   - Add async executor support.
   - Add `platform_action` executor routing.
   - Normalize missing capability and platform failure into structured tool errors.
3. [x] Update `apps/platform-web/src/agent-runtime/index.ts`.
   - Extend `AgentRuntimeCapabilities` with optional `runPlatformAction`.
   - Await async workspace tool execution.
   - Pass the platform action capability into tool execution context.
   - Update runtime tool instructions to mention `platform_action` support and limits.
4. [x] Update `apps/platform-web/src/platform-host/index.ts`.
   - Factor platform action execution into a helper reusable by frontend bridge and Agent Runtime.
   - Add an Agent Runtime platform action adapter with an allow-list.
   - Pass the adapter into `runAgentRuntimeTurn`.
   - If cheap, keep same-turn workspace read-after-write consistency by updating the in-memory `workspaceFiles` array after successful `workspace-write` / `workspace-delete`.
5. [x] Update documentation and specs.
   - `docs/active/agent-framework-runtime-workspace-direction.md`
   - `docs/active/current-state-handoff.md`
   - `.trellis/spec/platform-web/frontend/type-safety.md`
6. [x] Validate with runtime probes.
   - `platform_action` success with injected fake platform handler.
   - input schema failure does not invoke platform handler.
   - missing capability returns `PLATFORM_ACTION_UNAVAILABLE`.
   - platform handler `ok: false` returns `PLATFORM_ACTION_FAILED`.
   - builtin validation and echo still work.
7. [x] Run quality checks.
   - `npm run build:web`
   - `git diff --check`

## Risky Files

- `apps/platform-web/src/agent-runtime/workspace-tools.ts`
- `apps/platform-web/src/agent-runtime/index.ts`
- `apps/platform-web/src/platform-host/index.ts`
- `.trellis/spec/platform-web/frontend/type-safety.md`

## Rollback Points

- If async tool execution causes broad runtime churn, revert to making only action executor execution async and keep workspace read/list/search wrapped as resolved promises.
- If platform-host action factoring becomes too invasive, keep frontend bridge behavior unchanged and add a small Agent Runtime adapter that duplicates only the allow-list dispatch. Prefer factoring if the diff stays small.
- If same-turn workspace read-after-write consistency becomes complex, skip in-memory refresh and document that the action result plus next turn reflect the update.

## Review Gate Before Start

- Confirm the open decision in `prd.md`: MVP may directly reuse `workspace-write` / `workspace-delete` through a platform-host allow-list, while full transactional staging is out of scope.
- Confirm no UI is included.
- Confirm no default official Skill is included in this task.
