# Quality Guidelines

Contract changes are high impact because they compile through multiple workspace packages.

## Required Checks

- Always run `npm run build:contracts`.
- Run `npm run build:web` when platform-web imports the changed type.
- Run `npm run build:runtime-core` when runtime-core imports the changed type.

## Review Checklist

- Confirm `src/index.ts` exports new public types.
- Confirm each optional field is intentionally optional.
- Confirm open extension points use `unknown`, `Record<string, unknown>`, or index signatures only where callers preserve external fields.
- Confirm runtime validation did not move into contracts.

## Avoid

- Do not add package dependencies here.
- Do not change a contract without checking consuming package builds.
- Do not restore retired workflow/prompt/event/archive types as active contracts for convenience.
