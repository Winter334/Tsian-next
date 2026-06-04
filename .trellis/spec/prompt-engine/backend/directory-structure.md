# Directory Structure

The package is organized as a core prompt pipeline plus a Tsian wrapper API.

## Source Areas

- `src/core/types.ts` owns internal prompt-engine data structures, including `PresetInfo`, `PromptInfo`, `WorldBook`, `RegexScriptData`, `BuildPromptParams`, and `BuildPromptResult`.
- `src/core/modules/inputs/` normalizes and converts external inputs. `convertFromSillyTavern.ts` converts old SillyTavern preset, world book, regex, character, and history shapes into internal types.
- `src/core/modules/build/buildPrompt.ts` orchestrates the main pipeline.
- `src/core/modules/worldbook/` calculates active world book entries.
- `src/core/modules/regex/`, `macro/`, `variables/`, and `pipeline/` process text stages.
- `src/core/channels/` converts internal messages to `openai`, `gemini`, `tagged`, or `text` output.
- `src/tsian/assemble.ts` is the platform-facing wrapper around `buildPrompt`.
- `src/index.ts` exports core types, modules, channels, and the Tsian wrapper.

## Pipeline Ownership

`buildPrompt` is the central orchestration point:

1. Normalize preset compatibility (`other` vs deprecated `apiSetting`).
2. Normalize history to internal `parts` messages.
3. Activate world book entries from recent history.
4. Assemble tagged prompt items.
5. Merge global, preset, and character regex scripts.
6. Compile raw, macro, and post-regex stages.
7. Convert final output to the requested channel.

## Avoid

- Do not duplicate pipeline orchestration in `tsian/assemble.ts`; it should remain a wrapper around `buildPrompt`.
- Do not put platform-web workflow logic in prompt-engine.
- Do not add browser dependencies. Tests read fixtures from disk, but runtime code should stay platform-neutral.
