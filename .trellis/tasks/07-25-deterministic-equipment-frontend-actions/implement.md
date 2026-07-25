# Implementation Plan

1. Complete and approve both child planning sets.
2. Start and finish `07-25-card-frontend-action-runtime` first.
3. Verify its contracts, platform tests, security regression and SDK documentation; archive the child.
4. Rebase/review the equipment child assumptions against the implemented runtime, then start it.
5. Implement Schema, Frontend Action, Stage Manager Skill, shared/Skill-only test vectors and development UI; run build and browser checks; archive the child while preserving the packaged-frontend exclusion.
6. Perform the existing frontend source import/build/export as a later parent integration/release step, including published `@tsian/play-bridge` availability for the online builder.
7. Run parent integration review:
   - direct UI preview/commit;
   - Stage Manager equip/unequip/refresh;
   - parity vectors;
   - remote iframe permissions and mutation refresh;
   - no old Schema or partial-write path.
8. Archive the parent only after both children pass and the formal packaged frontend has been imported/built/exported and end-to-end verified.

## Review Gates

- Do not start the equipment child before the runtime child is committed and archived.
- Do not let equipment-specific logic enter the generic runtime.
- Do not let Frontend Actions appear in Agent/Skill/Tool indexes.
- Do not accept direct frontend workspace writes as an equipment transaction shortcut.
- Do not archive the parent merely because both children pass; require formal packaged-frontend import/build/export and end-to-end verification.
