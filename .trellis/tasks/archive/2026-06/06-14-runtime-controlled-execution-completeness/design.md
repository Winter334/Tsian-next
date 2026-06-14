# Runtime Controlled Execution Completeness Design

## Boundary

This child adds two small controlled-execution completions:

1. A lightweight executor-class policy layer.
2. Optional Skill action `outputSchema` result validation.

It is not a security product, marketplace review system, Skill trust database, player-facing prompt flow, remote executor slice, WASM runtime, or hosted execution system.

The policy lives at the Agent Runtime execution boundary:

- Skill text may declare actions.
- `skill_load` parses and records those declarations.
- `action_call` validates the loaded Skill/action/input.
- Before an executor runs, Agent Runtime asks the executor policy whether that executor class is enabled.
- Platform adapters still perform the actual side effects through injected capabilities.
- If the executor succeeds and the action declared `outputSchema`, Agent Runtime validates the output before returning a success observation.

## Policy Shape

Add an optional policy capability to the runtime workspace tool context, conceptually:

```ts
type RuntimeActionExecutorPolicy = (
  request: RuntimeActionExecutorPolicyRequest,
) => RuntimeActionExecutorPolicyDecision
```

The request should contain small metadata only:

- Skill name/path/scope and optional agent id.
- Action name.
- Executor type/name/path/timeout.

It should not include raw action input, raw script content, workspace file content, AI config, or API keys.

The default policy is code-level and has no persistence:

- `builtin`: enabled.
- `platform_action`: enabled, still constrained by the platform action allowlist.
- `browser_script`: enabled, still constrained by Worker isolation, Skill-local path checks, SDK-only access, timeout/abort, and staged workspace transactions.
- Unknown executor types keep the existing unsupported-executor behavior unless a future task adds a real adapter.

An injected policy may deny an otherwise supported executor class for tests or future platform-host experiments.

## Deny Contract

When policy denies execution, `action_call` returns a normal failed tool observation:

- code: `ACTION_EXECUTOR_DISABLED`
- message: concise executor-class disabled message
- details: skill/action/executor metadata plus policy reason/source when available

The turn should continue receiving ordinary tool observations. There is no modal, prompt, or UI interruption.

## Output Schema Shape

Action declarations may include optional `outputSchema`.

The schema is a lightweight subset rather than full JSON Schema:

- `type`: one of `array`, `boolean`, `integer`, `null`, `number`, `object`, `string`.
- object `required`: string field names that must exist when the output is an object.
- object `properties`: field schemas with the same `type` vocabulary.

Unsupported schema keywords are ignored for now.

Invalid `outputSchema` declarations should be reported as `ACTION_OUTPUT_SCHEMA_INVALID` during `skill_load` declaration parsing, and the invalid action should not register.

When `outputSchema` is absent, output behavior stays unchanged.

When `outputSchema` is present and executor output does not match, `action_call` returns a failed observation:

- code: `ACTION_OUTPUT_INVALID`
- message: concise output validation failure
- details: skill/action/executor metadata plus expected/actual summary

The raw output should not be duplicated into error details or trace data.

## Trace

Emit a compact policy trace event before execution:

- type: `action_executor_policy_checked`
- ok: policy decision
- data: skill/action/executor summary, decision source/reason

If denied, the existing `action_called` trace also records the failed observation error. Trace data must stay metadata-only and avoid raw payloads.

Output validation failures should also be visible through the existing `action_called` failed observation trace. A compact `outputSummary` may be recorded with `summarizeTraceValue`; do not persist full large outputs in trace details.

## Compatibility

Allowed `builtin`, `platform_action`, and `browser_script` behavior should remain compatible.

Actions without `outputSchema` remain byte-for-byte compatible at the observation contract level.

`platform_action` still uses the existing platform-host allowlist and staged Runtime Workspace transaction.

`browser_script` still resolves script paths under the declaring Skill directory and uses the current Worker + Tsian SDK execution model.

No SettingsView/localStorage changes are part of this slice.

## Deferred

- `remote_http`
- WASM execution
- hosted execution
- Skill marketplace trust
- per-Skill/per-script trust records
- runtime trust prompts
- content-hash approval
- full JSON Schema support
