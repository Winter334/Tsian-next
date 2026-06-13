# Implementation Plan

## Checklist

1. Read applicable specs with `trellis-before-dev`.
2. Extend runtime tool constants and prompt instructions with `action_call`.
3. Add Skill action declaration parsing in `workspace-tools.ts`.
4. Add per-Agent loaded Skill/action state for the current tool loop.
5. Register actions on successful `skill_load`.
6. Implement `action_call` validation-only execution.
7. Add structured observation errors for gating, unknown actions, invalid schemas, and invalid input.
8. Update direction docs and Trellis specs with the new contract.
9. Validate with builds and in-memory runtime probes.
10. Commit with a Chinese commit message.

## Validation

- `npm run build:web`
- `npm run build:contracts` if shared contracts change
- `git diff --check`
- In-memory probe:
  - `skill_load` then valid `action_call` succeeds
  - `action_call` before `skill_load` fails
  - unknown action fails
  - invalid input fails
  - final output strips tool-call blocks

## Risky Files

- `apps/platform-web/src/agent-runtime/workspace-tools.ts`
- `apps/platform-web/src/agent-runtime/index.ts`
- `.trellis/spec/platform-web/frontend/type-safety.md`
- `docs/active/agent-framework-runtime-workspace-direction.md`
- `docs/active/current-state-handoff.md`

## Rollback

Revert the runtime tool additions and docs/spec updates together. The feature is isolated to the runtime tool loop and should not require storage migration.
