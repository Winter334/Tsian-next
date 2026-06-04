# Error Handling

Contracts model error payloads but do not throw or validate at runtime.

## Error Payloads

- Use `PlatformActionError` for platform action failures exposed through bridge actions. It has `code`, `message`, and optional JSON-compatible `details`.
- Use package-specific error classes outside contracts when runtime code needs throwing behavior. Example: `packages/workflow-engine/src/errors.ts` defines `WorkflowValidationError`, `WorkflowAbortError`, and `WorkflowNodeError`.
- Keep error `details` JSON-compatible by using `JsonValue`. Do not place Error instances, functions, Dates, or class instances inside contract error payloads.

## Boundary Responsibility

- Contracts declare the shape; callers validate at feature boundaries. Example: `RuntimeWriteRequest` is normalized and checked in `apps/platform-web/src/platform-host/index.ts`.
- Workflow validation errors are implemented by workflow-engine because validation behavior belongs to that package, not the type package.
- Prompt preset and world book semantic validation belongs to prompt-engine or the consuming feature boundary, not to contracts.

## Avoid

- Do not add a generic catch-all `error?: unknown` to shared payloads.
- Do not encode UI language strings as contract error codes. Codes should be stable machine-readable identifiers; UI can translate messages separately.
- Do not add runtime parsing helpers to contracts to support error validation.
