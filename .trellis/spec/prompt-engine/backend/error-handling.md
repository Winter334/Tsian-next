# Error Handling

Prompt-engine favors tolerant conversion at import boundaries and deterministic output from normalized data.

## Conversion Boundaries

- SillyTavern conversion helpers accept broad `unknown`/`any` input and normalize to internal shapes. Example: `convertFromSillyTavern.ts` uses helpers such as `isObject`, `toArray`, `toStr`, `toNum`, and `toBool`.
- Invalid or missing optional input generally becomes an empty array, empty string, default number, or default boolean at conversion time.
- Preserve external compatibility fields in `other` when they are not first-class internal fields. `convertWorldBookEntryFromSillyTavern` moves remaining raw fields into `other`.

## Pipeline Errors

- `buildPrompt` expects normalized `BuildPromptParams`. Do not wrap the entire pipeline in broad catch blocks that hide broken module behavior.
- World book vector activation requires an injected `vectorSearch` callback. Without it, vector entries do not trigger; this is a designed non-error path.
- Variable macros mutate an explicit `VariableContext` and stringify non-string values predictably.

## Tests As Error Contracts

- `test/round-trip.test.ts` proves a real community preset can convert and assemble for `openai`, `text`, and `gemini` channels without throwing.
- Add fixture-based tests when supporting a new external format branch or compatibility field.

## Avoid

- Do not throw from broad conversion helpers for missing optional fields in old preset data.
- Do not silently discard unknown external fields if the editor/import path needs round-trip preservation.
- Do not catch pipeline errors only to return an empty prompt.
