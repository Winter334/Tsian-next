# Quality Guidelines

Because `runtime-core` is a shared interface package, small changes can break platform-web and play frontend bridge assumptions.

## Required Checks

- Run `npm run build:runtime-core`.
- Run `npm run build:web` when changing `RuntimeEngine`.
- Run `npm run build:contracts` if imported contract types changed.

## Review Checklist

- Confirm new methods are implementation-neutral.
- Confirm all method inputs and outputs use contract types or locally declared interface-only types.
- Confirm `src/index.ts` still re-exports the public interface.
- Confirm platform-web `LocalRuntimeEngine` implements any new method.

## Avoid

- Do not add default implementations.
- Do not add browser dependencies.
- Do not use `unknown` return values where a shared contract type already exists.
