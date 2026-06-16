# Generic Workspace Authoring Tools Design

## Current State

The platform already has runtime-facing workspace tools:

- read-only runtime tools: `workspace_read`, `workspace_list`, `workspace_search`;
- runtime side effects through loaded Skill actions and platform actions: `workspace-write`, `workspace-delete`;
- staged runtime writes during `interaction.sendMessage`;
- immediate frontend bridge writes/deletes through `platform.runAction`;
- save runtime write constraints under `save/...`;
- effective workspace reads that combine Game Card content with active save runtime data.

Those tools proved the basic runtime use cases, but they hardcode too much scope behavior into tool shape. The new system should subsume them instead of becoming a parallel authoring-only surface.

## Target Model

Create a generic workspace tool layer with stable file/workspace capabilities:

```text
workspace.list
workspace.search
workspace.read
workspace.diff
workspace.patch
workspace.write
workspace.move
workspace.delete
workspace.validate
```

The tool layer should not know that `agents/`, `skills/`, `docs/`, or `save/history/` are special concepts. It works on:

```text
scope + path + actorAccessLevel
```

Scope examples:

- `card-content`: Game Card-owned files.
- `save-runtime`: active Save Instance runtime files under `save/...`.
- `platform-meta`: platform metadata under `.tsian/...`.
- `effective`: read-only composed view when callers want the current runtime-visible workspace without choosing a storage owner.

Path semantics remain normalized root-relative paths without leading slash, backslash, `..`, empty segments, or NUL bytes.

Hard scope control comes from scope plus read/edit level checks. Soft scope control comes from Agent `AGENT.md` instructions, loaded Skill instructions, UI mode, and validator guidance. Tool implementation must not hardcode "runtime Agents can only edit this directory" or "authoring Agents can edit that directory"; the actor level and requested scope determine that.

## Operation Exposure

The tool suite should not be exposed as an all-or-nothing bundle.

Each tool execution context has an exposed operation set:

```text
list
search
read
diff
patch
write
move
delete
validate
```

An operation must pass two gates:

```text
operation is exposed to this context
actor level satisfies the target read/edit level
```

These gates solve different problems:

- operation exposure controls the current mode's available verbs and keeps prompts/tool surfaces compact;
- read/edit levels control which targets those verbs can affect;
- Agent/Skill instructions provide soft scope guidance and task intent.

Exposure sources:

- Platform/UI mode sets the outer profile, such as play, studio, maintainer, or platform-internal.
- `AGENT.md` frontmatter may request or declare default exposed operations for that Agent.
- Loaded Skill actions may expose a narrower operation by wrapping the generic tool system.

Recommended precedence:

```text
effective exposed operations = platform mode profile intersect Agent requested/default operations, plus currently loaded Skill action operations where applicable
```

This means a Studio Assistant can receive `read/search/diff/patch/write`, while an ordinary runtime Agent might receive only `list/search/read` unless a loaded Skill exposes a specific edit operation.

Skill exposure should be implemented as a Skill action executor shape, not as a second tool system. For example:

```json
{
  "name": "update_current_summary",
  "description": "Update this save's current memory summary.",
  "inputSchema": { "type": "object" },
  "executor": {
    "type": "workspace_operation",
    "operation": "patch",
    "scope": "save-runtime",
    "path": "save/memory/summaries/current.md"
  }
}
```

The Agent sees `action_call(update_current_summary)`, not unrestricted `workspace.patch`. The executor then calls the generic workspace operation internally. The generic operation still checks whether the operation is exposed and whether the actor level satisfies the target read/edit level.

## Access Levels

Access levels are collaboration semantics, not a strong security boundary.

The first model uses numeric levels:

```text
0 viewer
1 runtime editor
2 content author
3 workspace maintainer
4 platform internal
```

Default target levels:

```text
card-content:  readLevel 0, editLevel 2
save-runtime:  readLevel 0, editLevel 1
platform-meta: readLevel 4, editLevel 4
```

Decision rules:

```text
canRead = actor.level >= target.readLevel
canEdit = actor.level >= target.editLevel
```

Validation rule:

```text
editLevel >= readLevel
```

This rule prevents a path from being editable by an actor who cannot read it.

## Level Sources

Actor level:

- Agent default level should be read from `agents/<agent>/AGENT.md` frontmatter.
- Preferred field:

```yaml
workspaceAccess:
  level: 2
```

- Missing or invalid level defaults to `1`.
- Platform-internal callers may inject level `4`.

Target level:

- Defaults are determined by scope.
- Optional access metadata can later provide path overrides.
- Override resolution should use longest normalized path match.
- Directory override should apply to child paths.

The MVP may start with default levels and the Agent frontmatter level parser, while keeping the resolver shaped for path override support.

## Tool Semantics

Read operations:

- `list` and `search` return only readable entries/files.
- `read` requires `readLevel`.
- `effective` scope is read-only unless a later design defines deterministic write routing.
- `diff` requires `readLevel` and returns preview material without mutating storage.
- `validate` without auto-fix requires `readLevel`.

Edit operations:

- `patch`, `write`, `move`, and `delete` require `editLevel`.
- `move` requires edit access to both source and destination.
- `validate` with auto-fix requires edit access for every changed path.
- `patch` should be preferred for Agent-driven edits because it supports reviewable, minimal changes.

Patch format:

- Prefer a small structured patch format over raw shell patch syntax at the bridge/action boundary.
- A reasonable first shape is:

```typescript
interface WorkspaceAuthoringPatchRequest {
  scope: "card-content" | "save-runtime"
  path: string
  expectedContent?: string
  replacement: string
}
```

- A later richer patch can add line ranges or unified diff support.
- `expectedContent` enables optimistic conflict detection without implementing full merge conflict handling.

## Storage Boundaries

`card-content` edits should mutate Game Card `contentFiles`.

`save-runtime` edits should mutate the active save's runtime `workspaceFiles`.

`platform-meta` remains host-owned. It can fit into the same level model, but normal Studio/authoring Agents should not receive level `4` in the first slice.

Authoring reads may compose an effective view for display, but writes must target exactly one scope. Do not silently route card edits into save runtime data or save runtime edits into card content.

## Relationship To Existing Runtime Tools

Existing runtime tools should migrate onto the generic system:

- `workspace_read`, `workspace_list`, and `workspace_search` should be replaced by `workspace.read/list/search`.
- `workspace-write` and `workspace-delete` should be replaced by `workspace.write/delete/patch` with explicit scope.
- Browser Skill SDK workspace read/list/search/write/delete should use the same generic implementation internally.
- Platform bridge workspace actions should use the same generic implementation internally.

Prototype development allows breaking changes. Do not add old-name compatibility aliases unless implementation reveals an unavoidable bootstrap problem.

Runtime prompts can still steer ordinary play Agents toward `save-runtime`. That is a soft instruction. The hard boundary is that an actor without sufficient level cannot edit targets with higher `editLevel`, regardless of prompt text.

## Validation Direction

Validation must stay generic at the tool layer:

- path normalization;
- read/edit level checks;
- JSON parse checks when requested;
- frontmatter parse checks when requested;
- optional pluggable validators for Agent definitions, Skill definitions, action blocks, schema files, and package metadata.

Agent/Skill-specific validators are allowed as plugins, not as the foundation of browse/search/read/patch/write.

## Trade-Offs

- Numeric levels are less expressive than ACLs, but they are much easier to reason about and do not bind the platform to transient directory structures.
- Treating access levels as collaboration semantics means Agents can self-edit their declared level. This is acceptable for the current local-first, non-sensitive workspace model.
- Replacing old runtime tools reduces duplicated semantics, but requires updating default Skill examples and prompt text in the same implementation slice.
- Selective operation exposure adds one more gate, but keeps ordinary play prompts smaller and avoids handing every Agent mutation verbs when it only needs read/search.

## Compatibility

The local database is still prototype-grade. If implementing this task changes storage shape, a database reset remains acceptable unless the user asks for migration.

No package export format change is required unless access metadata becomes card-owned content in the implementation slice.
