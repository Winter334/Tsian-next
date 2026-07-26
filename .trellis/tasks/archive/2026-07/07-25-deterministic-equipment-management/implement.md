# Implementation Plan

## Session Resume Contract

This task is ready to enter implementation without further product discovery.

- Active task: `.trellis/tasks/07-25-deterministic-equipment-management`
- Runtime dependency commits:
  - `4cdeca9 feat(frontend): add card frontend action runtime`
  - `e174bb3 chore(task): archive card frontend action runtime`
- Approved product decisions and blocker resolutions are authoritative in this task's `prd.md` and `design.md`.
- Start with Step 1. Do not reopen schema/ownership/error questions unless actual code contradicts a written invariant.
- Preserve all unrelated dirty `.trellis/tasks/07-21-*` files.
- Do not modify formal card `frontend/**`, `frontendFiles`, cover/package metadata, exportedAt, or exporter.

Before editing, run `trellis-before-dev` and reload:

- `.trellis/spec/platform-web/frontend/{index,component-guidelines,hook-guidelines,state-management,quality-guidelines,type-safety}.md`
- `.trellis/spec/platform-web/storage/index.md`
- `.trellis/spec/contracts/frontend/type-safety.md`
- relevant shared guides named in `implement.jsonl`

## Step 1: Canonical fixture and parity harness first

Files:

```text
apps/platform-web/src/platform-host/equipment-scripts/
├── equipment-cases.json
├── equipment-script-harness.ts
└── equipment-scripts.test.ts
```

Tasks:

1. Define the fixture schema from design: encoded JSON/text file content, transport-neutral business input, success stateChanges or canonical business error.
2. Add schema validation for fixture version, unique case id, suite/operation consistency, normalized paths, and strict JSON values.
3. Implement resource providers:
   - internal: exact `createDefaultWorkspaceTemplateFiles()` materialization;
   - formal: recursively read exact `cards/沉浸阅读器.tsian-card/workspace/**` bytes.
4. Implement Action resolver using production Frontend Action registry and static import validation.
5. Implement Skill resolver using production Skill declaration/path/helper rules; select equip/unequip/refresh entry explicitly.
6. Execute actual distributed function-body scripts with Babel parse (`allowReturnOutsideFunction`, `allowAwaitOutsideFunction`) + AsyncFunction. Do not place equipment arithmetic in harness.
7. Build fresh RuntimeWorkspaceTransaction per target and target-specific SDK adapters. Observe final staged changes rather than write return shapes.
8. Normalize only mode/transport wrapper/correlationId/write wrapper. Compare canonical output/errors/state changes exactly.
9. Automatically run:
   - shared-mutation: internal/formal × Action preview/Action commit/Skill;
   - skill-refresh: internal/formal × Skill.
10. Add cases listed in design, including strict ref grammar, ownership-indeterminate, mutation failure zero-write, one-rounding counterexample, safe cancellation/overflow, true cycle versus diamond, stale behavior, and second refresh no-op.

Initial validation:

- Fixture parses and ids are unique.
- Harness may initially fail only because production equipment resources do not exist.
- No case-level target skip switches.

## Step 2: Implement canonical formal equipment resources

Implement formal resources first as readable source authority:

```text
cards/沉浸阅读器.tsian-card/workspace/frontend-actions/equipment/action.json
cards/沉浸阅读器.tsian-card/workspace/frontend-actions/equipment/run.js
cards/沉浸阅读器.tsian-card/workspace/agents/stage-manager/skills/装备管理/SKILL.md
cards/沉浸阅读器.tsian-card/workspace/agents/stage-manager/skills/装备管理/scripts/equip.js
cards/沉浸阅读器.tsian-card/workspace/agents/stage-manager/skills/装备管理/scripts/unequip.js
cards/沉浸阅读器.tsian-card/workspace/agents/stage-manager/skills/装备管理/scripts/refresh.js
cards/沉浸阅读器.tsian-card/workspace/agents/stage-manager/skills/装备管理/scripts/equipment-core.js
```

### Step 2A: Frontend Action

1. Write `action.json` closed input `oneOf` and output schema:
   - safe-integer min/max everywhere;
   - fixed wrapper `additionalProperties:false`;
   - dynamic map schema-valued `additionalProperties`;
   - `equipment` dynamic map → non-empty slot arrays;
   - slot `oneOf` exact empty/occupied;
   - no unsupported refs/vocabulary.
2. Implement Action-local core in `run.js` or Action-local declared helper loaded by static literal `importScripts`.
3. Implement canonical ref parser, entity loader, direct character listing, target graph, foreign ownership proof, stale/corrupt classification, BigInt arithmetic, normalization, stable business failures.
4. Preview and commit use the same pure plan. Preview performs no write. Commit writes only the character once after output validation.
5. Action adapter translates core failure through `tsian.action.fail`.

### Step 2B: Stage Manager Skill

1. SKILL.md must be self-contained, concise, and action-oriented. Declare exactly equip/unequip/refresh browser-script actions.
2. Use three thin entry scripts; each loads Skill-local `equipment-core.js` according to Skill helper rules.
3. Core independently implements the same shared business semantics and refresh-specific behavior. It must not read/import Action files.
4. Validate complete nested input/output inside Skill core because declaration validation is shallow.
5. Build plan/output fully, then issue exactly one character write; no fallible work after write.
6. Throw stable coded error-like values; do not claim Skill has `tsian.action.fail` or Action CAS.

Validation:

- `action.json` resolves/compiles with production registry/schema.
- Every changed browser script parses as function body and compiles with AsyncFunction.
- Shared Action/Skill cases pass for formal resources; refresh cases pass for formal Skill.
- Preview and all failures have zero staged write.
- Action and Skill trees have no cross-resource imports.

## Step 3: Add internal default Workspace resources

Prospective source organization:

```text
apps/platform-web/src/storage/workspace-templates/frontend-actions/equipment.ts
apps/platform-web/src/storage/workspace-templates/agents/stage-manager.ts
apps/platform-web/src/storage/workspace-templates/files.ts
```

Use a scoped equipment Action module/group; do not hide Action source in Stage Manager or docs modules.

Tasks:

1. Materialize exact logical paths listed in design.
2. Add all Stage Manager Skill files to `STAGE_MANAGER_SKILL_FILES`.
3. Add exact `agents/stage-manager/skills/装备管理/SKILL.md` to internal Stage Manager `skills.enabled` whitelist.
4. Add the same path to formal `workspace/agents/stage-manager/agent.json` while preserving formal-only tools/platformTools.
5. Keep internal materialized equipment Action/Skill bytes identical to formal source. Prefer a source-loading/generation pattern already accepted by repository; if TypeScript template literals are required, byte parity test is mandatory.
6. Do not bump Workspace version or add equipment migration.

Validation:

- Internal/formal resource byte parity.
- Both Agent registries show equipment Skill only for Stage Manager.
- Full execution matrix now passes for internal and formal distributions.
- `npm run build:web`.

## Step 4: Switch AIRP schema surfaces atomically

Internal files:

- `apps/platform-web/src/storage/workspace-templates/docs/airp.ts`
- `apps/platform-web/src/storage/workspace-templates/files.ts`
- related default examples/seeds discovered by exact reverse search.

Formal files:

- `cards/沉浸阅读器.tsian-card/workspace/docs/novel-airp-schema-guide.md`
- `cards/沉浸阅读器.tsian-card/workspace/docs/novel-airp-schema-reference.md`
- `cards/沉浸阅读器.tsian-card/workspace/agents/stage-manager/AGENT.md`
- `cards/沉浸阅读器.tsian-card/workspace/agents/stage-manager/skills/回合后维护/SKILL.md`
- schema-evolution content only where directly affected.

Tasks:

1. Replace character equipment with slot-type arrays and item equipment with slotType/add/percent/effects.
2. Document canonical ref/path/identity, fixed capacity, exact empty slot, safe integers, baseline/applied invariant, one-rounding BigInt formula, target/foreign ownership proof, quantity, stale refresh and corruption.
3. Update examples and living `save/schema/current.md` text.
4. Stage Manager AGENT/maintenance Skill should call equipment Skill for equip/unequip/refresh; ordinary active attribute changes use refresh.attributeChanges.
5. Remove old direct operator evaluation and manual equipment projection edits. Do not add compatibility/migration prose to AI-facing surfaces.
6. Preserve unknown `extensions.render` warn-and-hide contract and unrelated maintenance behavior.

Validation:

- Exact grep for `equipment.slot`, `mods`, old operators/formulas and dynamic single-slot examples across changed product surfaces; remaining hits must be unrelated generic editor/operator code or explicit developer history outside AI/runtime surfaces.
- Internal/formal schema meaning matches.
- Prompt self-containedness review.
- `npm run build:web`.

## Step 5: Switch play-frontend-dev data contracts

Existing files:

- `src/lib/character-types.ts`
- `src/lib/item-types.ts`
- `src/lib/parse-character.ts`
- `src/lib/parse-item.ts`
- `src/lib/load-inventory-entity.ts`

New pure seams:

```text
src/lib/equipment-action.ts
src/lib/load-character-inventory.ts
```

Tasks:

1. Parse only new slot arrays and slotType/add/percent/effects. No legacy fallback.
2. Implement shared frontend ref-to-path behavior consistent with canonical contract; reuse/extract existing entity path helper rather than add a third divergent version.
3. Validate safe integers, exact empty/occupied slot shape, slot arrays, item modifier maps, root/content counts and entity identity.
4. Return equipment-specific corrupt status while preserving displayable non-equipment character fields.
5. Expand load results to distinguish missing/read-failed/invalid-json/wrong-entity-type/schema-corrupt.
6. `equipment-action.ts` validates domain output shape, safe integer maps and request/output identity only; no formula.
7. `load-character-inventory.ts` recursively gathers presentation candidates/read paths with injectable loader. It must not make authoritative ownership/count/arithmetic decisions.
8. Add pure Vitest coverage for parsers, output parser, graph discovery, cycles/diamonds/status distinctions and path tracking.

Validation:

- Focused pure tests.
- `npm run build --workspace play-frontend-dev` may temporarily expose all remaining old consumers; migrate them in Step 6 rather than adding fallback.

## Step 6: Add Action-backed equipment UX

State owner and components:

```text
CharacterSlot.vue                           authoritative reload/coordinator owner
CharacterCard.vue                           presentation/event forwarding
CharacterStage.vue                          flatten indexed slots
EquipmentSlot.vue                           activate empty/occupied slot
InventoryPane.vue                           indexed labels + refresh-token reread
ItemDetailModal.vue                         new item equipment display
src/composables/useEquipmentManagement.ts   screen-local action lifecycle
src/components/equipment/EquipmentManagementDialog.vue
```

Tasks:

1. CharacterSlot creates screen-local coordinator, renders Dialog, owns authoritative character reload and workspaceRefreshToken.
2. CharacterStage flattens slot arrays preserving authored order and emits `{slotType,slotIndex,trigger}`.
3. EquipmentSlot is actionable for empty/occupied slots and retains read-only applied display.
4. InventoryPane preserves drill-in/independent scrolling; refresh token rereads current display without unnecessary breadcrumb reset.
5. Dialog lists recursively discovered candidates, explicit unequip, direct replacement wording, Action-provided before/after/delta, pending/stale/error/success states.
6. Implement preview AbortController + monotonic generation + immutable identity checks.
7. Build commit request from accepted preview identity; do not recompute expectedCurrentRef.
8. Do not abort commit because its mutation event arrives first. Capture immutable request before await.
9. On success or conflict, authoritative reread character/container/item graph. Mutation paths only invalidate; Action output is not persistent authority.
10. No automatic commit retry. Refresh-required points to maintenance in player language; hide raw code/path/schema/API details.
11. Reka Dialog focus trap/initial focus/Escape/return focus; roving/arrow keyboard candidate navigation; unavailable candidates focusable/readable with reason; live regions for status/errors.
12. Cleanup controllers/listeners on close/unmount and character changes.

Validation:

- Pure coordinator helpers test stale generation, abort, mutation-before-response, immutable expected ref, conflict reread/no retry.
- `npm run build --workspace play-frontend-dev`.
- Browser matrix desktop/mobile: empty equip, replace, unequip, conflict, refresh-required, keyboard navigation, Escape/focus return, independent scroll.

## Step 7: Rebuild formal card Workspace inventory only

File:

- `cards/沉浸阅读器.tsian-card/game-card.json`

Tasks:

1. Before changes or from `HEAD`, capture deep JSON snapshots/hashes for manifest, frontendFiles, coverFiles, exportedAt, exporter and recursively hash `cards/.../frontend/**`.
2. Walk actual formal `workspace/**` raw files.
3. Generate lexicographically sorted `workspaceFiles` with package-relative paths, raw byte size and platform media-type inference.
4. Replace only `workspaceFiles`.
5. Verify one-to-one path correspondence, uniqueness, no orphan, exact bytes/mediaType.
6. Deep-compare all protected metadata and assert formal frontend tree unchanged.
7. Do not use current exporter `string.length` fallback for UTF-8 size.

Validation:

- Scripted inventory check passes.
- `git diff --name-only -- cards/沉浸阅读器.tsian-card/frontend` is empty.
- `frontendFiles` deep-equal baseline.

## Step 8: Specs and final verification

Update the most scoped executable specs with final equipment contract; do not duplicate full task prose into broad docs.

Required commands:

```bash
npm run build:contracts
npm run test:frontend-actions
npm run test:frontend-actions:production-browser
npm run build --workspace @tsian/play-bridge
npm run build:web
npm run build --workspace play-frontend-dev
go -C apps/platform-server test ./internal/server
git diff --check
python ./.trellis/scripts/task.py validate .trellis/tasks/07-25-deterministic-equipment-management
```

Add the focused equipment test command/script once the harness exists and run it twice to catch leaked state.

Additional mechanical checks:

- parse every changed JSON;
- Babel parse + AsyncFunction compile every new/changed browser script;
- old schema/AI-facing residual grep;
- internal materialized/formal byte parity with explicit exception list;
- Action preview/failure zero writes; Action commit and Skill exactly one character write;
- no checkpoint from Action;
- runtime Action CAS/security suite remains green;
- unrelated `07-21-*` files remain unstaged/uncommitted;
- frozen formal frontend and metadata guards pass.

## Commit And Completion Boundary

Recommended commits:

1. `test(equipment): add deterministic parity fixtures`
2. `feat(card): add deterministic equipment resources`
3. `feat(frontend): add action-backed equipment management`
4. `chore(card): rebuild equipment workspace inventory`
5. task archive commit

Do not make partial schema commits that leave internal/formal resources semantically split. If commit granularity conflicts with atomic product validity, combine Steps 2–4 in one implementation commit while keeping fixture work separate.

This child can be archived when:

- all acceptance criteria and gates pass;
- development frontend works;
- formal Workspace Action/Skill/docs/inventory are complete;
- formal packaged frontend remains intentionally unchanged.

Parent `07-25-deterministic-equipment-frontend-actions` remains open until later formal frontend import/build/export and end-to-end verification.
