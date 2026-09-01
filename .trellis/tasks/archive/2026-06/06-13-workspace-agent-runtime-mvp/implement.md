# Workspace Agent Runtime MVP Implementation Plan

## Checklist

1. Load pre-development specs:
   - `.trellis/spec/platform-web/frontend/index.md`
   - `.trellis/spec/platform-web/frontend/type-safety.md`
   - shared guides.
2. Apply confirmed fallback strategy:
   - call `initializeWorkspaceForSave(activeSaveId)` before listing workspace files in `sendMessage`;
   - throw a clear runtime error if `master` or `narrative` context cannot be assembled from a non-empty workspace.
3. Update `apps/platform-web/src/agent-runtime/index.ts`:
   - import `WorkspaceFile` and `assembleAgentContext`;
   - add optional `workspaceFiles` to turn input;
   - build master/narrative messages from `AgentContextEntry` when available;
   - keep concise platform guards for master/narrative output behavior;
   - keep recent history/stateRecords formatting.
4. Update `apps/platform-web/src/platform-host/index.ts`:
   - read `listWorkspaceFilesForSave(activeSaveId)` before calling runtime;
   - pass workspace files into `runAgentRuntimeTurn`.
5. Update `.trellis/spec/platform-web/frontend/type-safety.md` or a better spec target with the workspace-defined runtime contract.
6. Update active docs if implementation status changes.
7. Validate:
   - `npm run build:web`;
   - `npm run build:contracts` if contracts changed;
   - in-memory probe for prompt assembly behavior if practical.
8. Review `git diff` for accidental changes to save/checkpoint/AI debug behavior.

## Risky Files

- `apps/platform-web/src/agent-runtime/index.ts`: prompt assembly changes can affect model behavior.
- `apps/platform-web/src/platform-host/index.ts`: must preserve sendMessage rollback/checkpoint behavior.
- `.trellis/spec/platform-web/frontend/type-safety.md`: cross-layer runtime behavior should be documented concretely.

## Out-Of-Scope Guardrails

- Do not add action/tool parsing.
- Do not write workspace files from runtime.
- Do not change debug record shape.
- Do not broaden bridge contracts unless necessary.

## Review Gate Before Start

Implementation may begin after the fallback strategy is confirmed and the user approves these planning artifacts.
