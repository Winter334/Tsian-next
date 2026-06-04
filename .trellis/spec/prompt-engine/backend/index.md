# prompt-engine Authoring Specs

`packages/prompt-engine` builds prompts from preset, world book, regex, macro, variable, and history inputs. It is a pure TypeScript package with Vitest coverage for real SillyTavern preset round-trips.

| Guide | Use When | Status |
|-------|----------|--------|
| [Directory Structure](./directory-structure.md) | Adding prompt-engine modules or exports | Filled |
| [Error Handling](./error-handling.md) | Deciding how conversion and assembly handle invalid input | Filled |
| [Quality Guidelines](./quality-guidelines.md) | Verifying prompt-engine behavior | Filled |

## Required Checks

- Run `npm run build:prompt-engine` for package changes.
- Run `npm run test:prompt-engine` for conversion, world book, regex, macro, variable, channel, or assembly behavior changes.

## Source References

- `packages/prompt-engine/src/core/types.ts`
- `packages/prompt-engine/src/core/modules/build/buildPrompt.ts`
- `packages/prompt-engine/src/core/modules/inputs/convertFromSillyTavern.ts`
- `packages/prompt-engine/src/tsian/assemble.ts`
- `packages/prompt-engine/test/round-trip.test.ts`
