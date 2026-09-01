# Skill On-Demand Loading MVP Design

## Scope

This task adds the first detail-loading layer for workspace-defined skills.

After this task, Tsian can answer:

- Given a selected skill registry entry path, what are the full `SKILL.md` instructions?
- What other resource files exist under that skill directory?

It cannot yet:

- inject loaded skills into live agent prompts;
- execute skill actions;
- parse action schemas;
- automatically load all references/examples/scripts;
- migrate fixed master/narrative runtime prompts to workspace-defined agents.

## Architecture

### Contracts

Add shared bridge-visible shapes to `packages/contracts/src/runtime.ts`:

```ts
interface SkillResourceEntry {
  path: string
  name: string
  relativePath: string
  mediaType: string
  size: number
  updatedAt: number
}

interface SkillDetailEntry {
  registry: SkillRegistryEntry
  file: WorkspaceFile
  resources: SkillResourceEntry[]
}
```

Notes:

- `registry` preserves the same lightweight metadata returned by `skill-registry`.
- `file` is the selected `SKILL.md` workspace file, including full content.
- `resources` indexes files under the skill directory, excluding the selected `SKILL.md`.
- Resource contents are intentionally not included.

### Selector

The MVP should use `path` as the primary selector:

```ts
bridge.query.query<SkillDetailEntry>({
  resource: "skill-detail",
  params: { path: "skills/example/SKILL.md" },
})
```

Why path first:

- `SkillRegistryEntry.path` is already available and disambiguates shared vs agent-local skills.
- Skill ids can collide across shared and agent-local scopes.
- Agent-local paths naturally encode the owning agent.

Optional id-based lookup can be added later if a runtime orchestration layer wants friendlier inputs.

### Path Rules

Valid entry paths:

- shared skill: `skills/<skillId>/SKILL.md`;
- agent-local skill: `agents/<agentId>/skills/<skillId>/SKILL.md`.

Invalid paths return no detail:

- non-string or blank path;
- normalized path outside valid skill locations;
- path ending in anything other than `SKILL.md`;
- missing file.

Use existing workspace path normalization at the storage boundary. The pure registry/detail helper should still treat only the valid path patterns as loadable skills.

### Detail Loader

Extend `apps/platform-web/src/agent-runtime/registry.ts` with a pure helper:

```ts
function loadSkillDetail(
  files: WorkspaceFile[],
  path: string,
): SkillDetailEntry | null
```

Implementation behavior:

1. Find the `WorkspaceFile` with exact path.
2. Confirm the path matches a valid shared or agent-local skill entry.
3. Reuse existing registry parsing/fallback behavior to build a `SkillRegistryEntry`.
4. Build a resource index from files whose paths start with the skill directory prefix.
5. Exclude the selected `SKILL.md`.
6. Sort resources by `relativePath`.

The helper should remain pure and must not import Dexie, bridge objects, model clients, or storage tables.

### Resource Index

The resource index includes direct and nested files under the skill directory:

```text
skills/example/SKILL.md
skills/example/references/rules.md
skills/example/examples/basic.md
skills/example/scripts/helper.js
```

For `skills/example/references/rules.md`, return:

```ts
{
  path: "skills/example/references/rules.md",
  name: "rules.md",
  relativePath: "references/rules.md",
  mediaType: "text/markdown",
  size: file.content.length,
  updatedAt: file.updatedAt,
}
```

This keeps `SKILL.md` lean while letting a later agent/runtime step choose which resource to read with `workspace-read` or a future skill-resource query.

### Bridge API

Extend `apps/platform-web/src/platform-host/index.ts` query handling:

- `skill-detail`
  - active save required;
  - `params.path` must be a string;
  - read all workspace files for the active save;
  - return zero or one `SkillDetailEntry`.

Default response rules:

- no active save -> `{ items: [] }`;
- invalid path -> `{ items: [] }`;
- missing skill file -> `{ items: [] }`;
- valid path -> `{ items: [detail] }`.

### Data Flow

```text
caller
  -> bridge.query({ resource: "skill-registry", params })
  -> chooses SkillRegistryEntry.path
  -> bridge.query({ resource: "skill-detail", params: { path } })
  -> platform-host gets active save id
  -> storage lists workspace files
  -> pure loader builds detail
  -> bridge returns SKILL.md content + resource index
```

### Compatibility

- `skill-registry` remains unchanged and lightweight.
- Existing workspace APIs remain unchanged.
- Existing runtime turn execution remains unchanged.
- Existing saves do not need migration; the query works for any current workspace containing valid `SKILL.md` files.

### Trade-Offs

- Returning only `SKILL.md` content plus a resource index keeps the MVP aligned with progressive disclosure.
- Using `path` avoids ambiguity without adding new id resolution rules.
- Reading all workspace files is acceptable for this stage because workspace files are local Dexie text records and the registry code already follows that pattern. A later indexing/cache layer can optimize if needed.

## Rollback

The change is additive:

- Remove `SkillResourceEntry` and `SkillDetailEntry` contracts.
- Remove the detail-loading helper from `agent-runtime/registry.ts`.
- Remove the `skill-detail` bridge query case.
