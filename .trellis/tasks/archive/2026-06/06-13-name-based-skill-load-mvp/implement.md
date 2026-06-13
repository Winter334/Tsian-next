# name-based skill.load MVP Implementation Plan

## Checklist

- [x] Refresh relevant specs before editing:
  - `.trellis/spec/guides/index.md`
  - `.trellis/spec/platform-web/frontend/index.md`
  - `.trellis/spec/platform-web/frontend/type-safety.md`
  - `.trellis/spec/contracts/frontend/index.md` if contracts change
- [x] Update shared contracts if using additive `name/description` fields:
  - `packages/contracts/src/runtime.ts`
  - contracts frontend spec if needed
- [x] Update registry parsing in `apps/platform-web/src/agent-runtime/registry.ts`:
  - parse `name` first, fallback to existing `id` / path directory;
  - parse `description` first, fallback to `summary` / first body paragraph;
  - preserve existing fields and sorting stability.
- [x] Extend runtime tool execution:
  - support `skill.load`;
  - pass current `AgentContextEntry` into tool execution;
  - resolve visible Skill by `name`, fallback `id`;
  - local Skill priority over shared Skill;
  - structured errors for missing, invalid, ambiguous, or unloadable Skill.
- [x] Update runtime prompt formatting:
  - Skill Index displays `name/description/triggers/applicability`;
  - default prompt no longer exposes `path=...`;
  - tool instructions prefer `skill.load(name)` for Skill detail and workspace tools for third-layer resources.
- [x] Preserve previous workspace tools:
  - `workspace.read`
  - `workspace.list`
  - `workspace.search`
- [x] Run in-memory probes:
  - shared Skill load by name;
  - Agent-local Skill load by name;
  - local-over-shared duplicate name priority;
  - unknown Skill name returns tool error observation;
  - `skill.load` observation does not include resource index;
  - workspace read still works when `SKILL.md` references a resource path.
- [x] Run validation:
  - `npm run build:contracts` if contracts changed;
  - `npm run build:web`.
- [x] Update direction docs and specs:
  - direction doc should describe `skill.load(name)` as second layer;
  - current-state handoff should reflect new status;
  - platform-web type-safety spec should replace the previous “no skill.load” convention.
- [ ] Commit with a Chinese commit message after checks pass.

## Risky Files

- `packages/contracts/src/runtime.ts`
  - Shared contract changes affect bridge consumers. Prefer additive fields over renaming/removing existing fields.
- `apps/platform-web/src/agent-runtime/registry.ts`
  - Keep parser pure; do not import storage/bridge.
- `apps/platform-web/src/agent-runtime/workspace-tools.ts`
  - May need to become a broader runtime tools module; avoid mixing platform-host concerns into it.
- `apps/platform-web/src/agent-runtime/index.ts`
  - Prompt assembly and tool loop live here; keep changes scoped.
- `.trellis/spec/platform-web/frontend/type-safety.md`
  - Existing spec currently says Skill detail is loaded by `workspace.read`; update it to the new layered model.
- `docs/active/agent-framework-runtime-workspace-direction.md`
  - Current text says live runtime does not need `skill.load`; this task intentionally reverses that direction.

## Validation Details

Use the same esbuild-backed in-memory probe style from the previous task if no dedicated test runner exists:

```bash
node_modules/.bin/esbuild apps/platform-web/src/agent-runtime/index.ts \
  --bundle --platform=node --format=esm --outfile=/tmp/tsian-agent-runtime-probe.mjs
```

Then import `runAgentRuntimeTurn` from the bundle and fake `callModel` responses:

1. Master first call emits `skill.load` for a shared Skill name.
2. Master second call asserts observation contains the loaded `SKILL.md` body and no resource index.
3. Narrative first call emits `skill.load` for an Agent-local Skill name.
4. Narrative second call returns final player text.

Add a second probe for duplicate local/shared name priority and unknown Skill error observation.

## Rollback Points

- If additive contract fields create unexpected churn, keep contract fields unchanged and make prompt formatting derive model-facing `name/description` from existing `id/summary`.
- If `skill.load` complicates the generic tool executor too much, implement it as a sibling pure helper called from the tool loop, then refactor later.
- If prompt behavior degrades, keep `skill.load` but reduce workspace tool instructions to a short “only read files explicitly referenced by the loaded skill or current task” paragraph.
