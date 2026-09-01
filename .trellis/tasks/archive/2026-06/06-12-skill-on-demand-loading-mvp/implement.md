# Skill On-Demand Loading MVP Implementation Plan

## Checklist

1. Read implementation guidelines with `trellis-before-dev`.
2. Add shared contract types in `packages/contracts/src/runtime.ts`:
   - `SkillResourceEntry`;
   - `SkillDetailEntry`.
3. Extend `apps/platform-web/src/agent-runtime/registry.ts`:
   - add a pure `loadSkillDetail(files, path)` helper;
   - reuse existing path patterns and metadata fallback behavior;
   - build `SkillResourceEntry[]` for files under the skill directory;
   - exclude the selected `SKILL.md` from resources;
   - sort resources by `relativePath`.
4. Integrate `skill-detail` query in `apps/platform-web/src/platform-host/index.ts`:
   - active save required;
   - normalize `params.path` at the boundary;
   - return zero or one `SkillDetailEntry`.
5. Keep existing runtime execution unchanged:
   - do not modify `runAgentRuntimeTurn`;
   - do not modify `interaction.sendMessage`;
   - do not inject loaded skills into prompts.
6. Run behavior verification:
   - shared skill path loads detail;
   - agent-local skill path loads detail;
   - invalid/missing paths return empty results;
   - resources are indexed without contents.
7. Run build validation:
   - `npm run build:contracts`;
   - `npm run build:web`.
8. Update `.trellis/spec/` only if implementation reveals a reusable convention beyond the current registry query spec.

## Risk Points

- Do not let `skill-detail` accidentally become a bulk directory-content loader.
- Do not include sibling resource file contents in `SkillResourceEntry`.
- Do not parse, expose, or execute action definitions in this task.
- Keep registry/detail parsing pure; no Dexie or bridge imports in `agent-runtime/registry.ts`.
- Path validation should reject non-skill paths rather than exposing arbitrary workspace files through the skill-detail resource.
- `SkillRegistryEntry.path` is the source of truth for selecting details in this MVP.

## Review Gates

- Do not start implementation until planning artifacts are reviewed and approved.
- Keep changes scoped to contracts, registry/detail helper, and platform-host bridge query.
- No UI changes.
- No runtime prompt-chain migration.
- No action executor work.

## Validation Commands

```bash
npm run build:contracts
npm run build:web
```

## Manual Probe

Use a small in-memory call to `loadSkillDetail` with files shaped like:

```text
skills/example/SKILL.md
skills/example/references/rules.md
agents/narrative/skills/style/SKILL.md
agents/narrative/skills/style/examples/basic.md
```

Expected:

- detail includes full selected `SKILL.md` content;
- resources include `references/rules.md` or `examples/basic.md`;
- resource entries include size/mediaType/updatedAt but no content;
- invalid paths return `null`.
