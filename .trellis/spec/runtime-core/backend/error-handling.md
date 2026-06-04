# Error Handling

`runtime-core` declares async interface methods; concrete error behavior belongs to implementations.

## Interface Rule

- Do not define runtime error classes in this package until multiple runtime implementations need the same thrown error type.
- Use existing contract result types where errors are part of the API payload. Example: platform actions return `PlatformActionResult`.
- Let implementations throw for unsupported deprecated paths. `LocalRuntimeEngine.sendMessage` throws because platform-host now owns workflow execution.

## Boundary Rule

- The interface should not hide failures with default snapshots or empty results unless the method contract explicitly says so.
- If a new method needs structured failure data, put the payload shape in `@tsian/contracts` and keep runtime-core as the interface consumer.

## Avoid

- Do not catch and convert all errors to `{ items: [] }` or similar in the interface package.
- Do not add implementation-specific error codes here.
