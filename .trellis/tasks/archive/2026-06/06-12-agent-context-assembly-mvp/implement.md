# Agent 上下文组装 MVP Implementation Plan

## Checklist

1. Load pre-development specs:
   - `.trellis/spec/platform-web/frontend/index.md`
   - `.trellis/spec/platform-web/frontend/type-safety.md`
   - `.trellis/spec/contracts/frontend/index.md`
   - `.trellis/spec/contracts/frontend/type-safety.md`
   - shared guides if cross-layer questions arise.
2. Add `AgentContextEntry` contract in `packages/contracts/src/runtime.ts`.
3. Add pure context assembly helper in `apps/platform-web/src/agent-runtime/`, likely `context.ts`:
   - resolve agent by id from `buildAgentRegistry`;
   - return null for unknown agent;
   - include `agentFile`, optional `notesFile`, optional `sessionFile`;
   - include visible skill index via `buildSkillRegistry`;
   - include declared context files and missing paths.
4. Integrate bridge query in `apps/platform-web/src/platform-host/index.ts`:
   - import contract/helper;
   - handle `resource === "agent-context"`;
   - validate `params.agentId` as non-empty string;
   - return one item or empty items.
5. Update active docs for implemented status.
6. Run validation:
   - `npm run build:contracts`
   - `npm run build:web`
   - optional in-memory probe for helper behavior with shared/local skills and missing paths.
7. Review `git diff` for accidental runtime behavior changes.

## Risky Files

- `packages/contracts/src/runtime.ts`: contract shape must remain serializable and browser-safe.
- `apps/platform-web/src/agent-runtime/registry.ts`: avoid modifying existing parser behavior unless necessary.
- `apps/platform-web/src/platform-host/index.ts`: bridge query additions must not affect existing resources.
- `docs/active/current-state-handoff.md`: keep implementation status accurate without overstating future work.

## Validation Notes

- Because this task does not alter `interaction.sendMessage`, build checks plus helper probe are enough for the MVP.
- If type exports fail in consumers, prefer adding explicit imports from `@tsian/contracts` rather than duplicating local types.

## Review Gate Before Start

Implementation may begin once the user approves this PRD/design/implement scope.
