# Design

## Architecture

The MVP extends the existing runtime workspace tool loop in `apps/platform-web/src/agent-runtime`.

- `workspace-tools.ts` owns parsing and execution of textual runtime tool calls.
- `index.ts` owns prompt composition and the per-Agent tool loop.
- Skill action declarations are parsed from loaded `SKILL.md` content, not from the eager Skill Index.
- Loaded Skill/action state lives only in memory for one Agent's current tool loop.

No storage, bridge, Dexie, or platform-host dependencies should be introduced.

## Action Declaration Contract

`SKILL.md` can include one fenced JSON block with info string containing `tsian-actions`.

````md
```json tsian-actions
[
  {
    "name": "example_action",
    "description": "Validate an example action payload.",
    "inputSchema": {
      "type": "object",
      "required": ["text"],
      "properties": {
        "text": { "type": "string" }
      }
    }
  }
]
```
````

MVP fields:

- `name`: required non-empty string.
- `description`: optional string.
- `inputSchema`: optional object-schema subset.

The parser should ignore malformed or invalid action declarations for registry purposes but should report enough metadata in `skill_load` observation for debugging if useful.

## Runtime Tool Contract

Add `action_call` to `RUNTIME_WORKSPACE_TOOL_NAMES`.

Tool payload:

```json
{
  "name": "action_call",
  "arguments": {
    "skill": "prose-style",
    "action": "example_action",
    "input": {
      "text": "hello"
    }
  }
}
```

Validation:

- `skill` must be a non-empty string.
- `action` must be a non-empty string.
- `input` must be an object; absent input is treated as `{}`.
- The Skill must have been loaded successfully by the same Agent during the same tool loop.
- The action must be declared by that loaded Skill.
- If `inputSchema` is present, validate against the MVP subset.

Success result:

```json
{
  "status": "validated",
  "skill": { "name": "prose-style", "scope": "shared" },
  "action": { "name": "example_action", "description": "..." },
  "input": { "text": "hello" }
}
```

MVP must not execute code, mutate workspace/state, or call remote resources.

## Schema Subset

Support a small JSON-schema-like object subset:

- root `type` may be omitted or `"object"`;
- `required` may be an array of strings;
- `properties` may define fields with `type`;
- supported field types: `string`, `number`, `integer`, `boolean`, `object`, `array`, `null`;
- unknown schema keywords are ignored.

If schema is missing, only require that `input` is an object.

## Data Flow

1. Agent sees lightweight Skill Index.
2. Agent calls `skill_load`.
3. Runtime resolves the visible Skill and reads its `SKILL.md`.
4. Runtime parses `tsian-actions` declarations from the loaded Skill.
5. Runtime records loaded Skill state for the active Agent's tool loop.
6. Agent calls `action_call`.
7. Runtime validates loaded Skill gating, action existence, and input schema.
8. Runtime returns an observation with validation success or structured error.

## Trade-Offs

- Body fenced JSON is chosen over frontmatter because existing frontmatter parsing only supports simple metadata.
- The MVP intentionally avoids a general JSON Schema dependency.
- `action_call` is validation-only so the future executor registry can be designed separately without coupling to this parser.

## Compatibility

The project is still in prototype stage. No old action format or tool-name compatibility is required.
