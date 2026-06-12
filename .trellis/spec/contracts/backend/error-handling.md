# Error Handling

Contracts model error payloads but do not throw or validate at runtime.

## Error Payloads

- Use `PlatformActionError` for platform action failures exposed through bridge actions. It has `code`, `message`, and optional JSON-compatible `details`.
- Keep error `details` JSON-compatible by using `JsonValue`. Do not place Error instances, functions, Dates, or class instances inside contract error payloads.
- Package-specific throwing behavior belongs in the consuming package, usually `apps/platform-web`.

## Boundary Responsibility

- Contracts declare shape only.
- `platform-host` validates bridge action inputs before mutating runtime/storage.
- Storage helpers validate JSON-compatible state write operations.

## Avoid

- Do not add generic `error?: unknown` fields to shared payloads.
- Do not encode UI language strings as contract error codes.
- Do not add runtime parsing helpers to contracts.
