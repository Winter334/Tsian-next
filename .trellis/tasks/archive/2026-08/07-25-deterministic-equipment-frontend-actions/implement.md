# Implementation Plan

1. Complete and approve both child planning sets.
2. Start and finish `07-25-card-frontend-action-runtime` first.
3. Verify its contracts, platform tests, security regression and SDK documentation; archive the child.
4. Rebase/review the equipment child assumptions against the implemented runtime, then start it.
5. Implement Schema, Frontend Action, Stage Manager Skill, shared/Skill-only test vectors and development UI; run build and browser checks; archive the child while preserving the packaged-frontend exclusion.
6. Verify the formal card Workspace distribution only: required equipment Action/Skill/docs exist, Stage Manager enables the equipment Skill, and `game-card.json.workspaceFiles` has one-to-one path coverage with no missing/orphan/duplicate entries. The user packages and uploads the development frontend separately.
7. Run parent integration review:
   - direct UI preview/commit;
   - Stage Manager equip/unequip/refresh;
   - parity vectors;
   - remote iframe permissions and mutation refresh;
   - no old Schema or partial-write path;
   - formal Workspace completeness.
8. Archive the parent after both children pass and the formal Workspace completeness review succeeds; formal packaged frontend synchronization is out of scope.

## Review Gates

- Do not start the equipment child before the runtime child is committed and archived.
- Do not let equipment-specific logic enter the generic runtime.
- Do not let Frontend Actions appear in Agent/Skill/Tool indexes.
- Do not accept direct frontend workspace writes as an equipment transaction shortcut.
- Do not archive the parent merely because both children pass; require the formal Workspace Action/Skill/docs and path inventory completeness review. Do not add a direct formal-frontend synchronization gate.
