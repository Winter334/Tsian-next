# Platform UI Development Phase Implementation Plan

## Parent Checklist

1. Review parent PRD/design/implement with the user.
2. Select the first child implementation slice.
3. For the selected child, complete child-level planning:
   - refine `prd.md`;
   - add `design.md` for complex UI/data-flow work;
   - add `implement.md` with ordered steps and validation.
4. Start only the selected child with `task.py start`.
5. Implement, check, commit, and archive children one at a time.
6. Update parent PRD status after each child is completed or deferred.
7. Archive parent only after all children are completed or explicitly deferred.

## Recommended Child Order

0. `06-15-card-owned-content-save-runtime-data-model`
   - Reason: resolves the foundation conflict between the current save-scoped workspace-copy implementation and the proposed model where Game Cards own Agent/Skill/schema content and saves own runtime data.

1. `06-15-platform-shell-navigation-ui`
   - Reason: establishes the visually expressive home navigation hub, quick actions, route structure, and page-level wayfinding that replace a traditional persistent nav bar.

2. `06-15-game-card-library-save-flow-ui`
   - Reason: gives the home hub real destinations and establishes the Game Card Library -> Game Card Detail -> Save Instance -> Play model. Can start as thin UI, but deep save/workspace behavior depends on the model decision.

3. `06-15-game-card-package-frontend-binding-ui`
   - Reason: plugs frontend binding and package flows into the Game Card detail surface.

4. `06-15-runtime-diagnostics-settings-ui`
   - Reason: improves safety while deeper authoring surfaces are added.

5. `06-15-runtime-workspace-studio-ui`
   - Reason: gives authors direct card content and save runtime data visibility after the data model is resolved.

6. `06-15-agent-skill-assistant-studio-ui`
   - Reason: builds on card-owned content visibility and effective-workspace registry/detail contracts.

7. `06-15-default-packaged-game-frontend`
   - Reason: should use the finalized card/package/frontend-binding UX.

## Validation Commands

Run for any platform-web child:

```bash
npm run build:web
git diff --check
```

Run when contract shapes change:

```bash
npm run build:contracts
npm run build:web
```

Run when runtime-core changes:

```bash
npm run build:runtime-core
```

Use browser smoke checks for user-facing UI changes, especially:

- route loads;
- no console errors;
- empty states;
- create/select/delete flows;
- import/export flows;
- `/play` missing-frontend error;
- packaged/remote frontend mount behavior when touched.

## Risky Files

- `apps/platform-web/src/App.vue`
- `apps/platform-web/src/router/index.ts`
- `apps/platform-web/src/views/*.vue`
- `apps/platform-web/src/platform-host/index.ts`
- `apps/platform-web/src/storage/*`
- `packages/contracts/src/game-card.ts`
- `packages/contracts/src/workspace.ts`

## Rollback Points

- Route/shell changes should be isolated from storage changes where possible.
- Package import/export and frontend binding changes should keep storage helper validation centralized.
- Workspace editing UI must preserve path normalization and `.tsian/*` metadata rules.
