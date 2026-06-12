# Type Safety

`platform-web` is strict TypeScript. Normalize unknown data at runtime boundaries and keep shared shapes in `@tsian/contracts`.

## Shared Contracts

- Import bridge, runtime, debug, frontend package, and state record shapes from `@tsian/contracts`.
- Import `RuntimeEngine` from `@tsian/runtime-core`.
- Do not redefine cross-package payloads in platform-web.

## Runtime Boundaries

- Treat AI responses as untrusted strings unless a later task adds structured output validation.
- Validate bridge/platform action inputs before mutating storage.
- Keep `StateWriteOperation` handling JSON-compatible and fail loudly on invalid writes.
- Convert query params at the platform-host boundary before passing to storage helpers.

## Scenario: Runtime Workspace Registry Queries

### 1. Scope / Trigger

- Trigger: platform-web exposes cross-layer bridge query resources backed by Runtime Workspace files.
- Applies when adding or changing `agent-registry` or `skill-registry` behavior in `platform-host`.

### 2. Signatures

- `bridge.query.query<AgentRegistryEntry>({ resource: "agent-registry" })`
- `bridge.query.query<SkillRegistryEntry>({ resource: "skill-registry", params })`
- `params.agentId?: string`
- `params.includeShared?: boolean`
- `params.includeLocal?: boolean`

### 3. Contracts

- `agent-registry` returns lightweight `AgentRegistryEntry[]` built from `agents/*/AGENT.md`.
- `skill-registry` returns lightweight `SkillRegistryEntry[]` built from `skills/*/SKILL.md` and `agents/*/skills/*/SKILL.md`.
- Registry entries include path and metadata fields only. Do not expose full skill instructions, actions, schemas, examples, scripts, or references through the registry query.
- Shared registry shapes live in `@tsian/contracts`; platform-web must not redefine them locally.
- Registry parsing is owned by `src/agent-runtime/registry.ts` and must stay pure: pass workspace files in, return entries out. It must not import Dexie tables or bridge objects.

### 4. Validation & Error Matrix

- No active save -> return `{ items: [] }`.
- Missing or partial frontmatter -> infer safe fallbacks from path, first H1, and first body paragraph.
- Malformed frontmatter -> do not throw from the whole registry query; degrade to path/body fallbacks.
- Non-boolean `includeShared` / `includeLocal` -> treat as omitted.
- Blank or non-string `agentId` -> treat as omitted.

### 5. Good/Base/Bad Cases

- Good: `skill-registry` with `{ agentId: "narrative" }` returns shared skills plus `agents/narrative/skills/*/SKILL.md`.
- Base: `skill-registry` without params returns shared skills and all agent-local skills.
- Bad: registry query returns `SKILL.md` body text or parsed `actions`; this breaks progressive disclosure.

### 6. Tests Required

- Assert new saves include default `agents/master/AGENT.md` and `agents/narrative/AGENT.md`.
- Assert `agent-registry` returns master and narrative entries for a new save.
- Assert shared and agent-local skills are discovered and sorted deterministically.
- Assert malformed or missing frontmatter does not crash parsing.
- Assert `includeShared`, `includeLocal`, and `agentId` filtering behavior.

### 7. Wrong vs Correct

#### Wrong

```typescript
return {
  items: files.map((file) => ({ ...parseSkill(file.content), content: file.content })),
}
```

#### Correct

```typescript
const files = await listWorkspaceFilesForSave(activeSaveId)
return {
  items: buildSkillRegistry(files, { agentId, includeShared, includeLocal }),
}
```

## JSON State

- `RuntimeGlobalsMap` and state record `data` must remain JSON-compatible.
- Do not loosen contract fields to `unknown` to hide caller bugs.

## Avoid

- Do not reintroduce old prompt/world-book/workflow resource contracts for new Agent Runtime work.
- Do not leak Dexie table records directly into contracts unless they are intentionally shared.
- Do not silently swallow invalid platform action input.
