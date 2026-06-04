# Type Safety

Frontend consumers should use the Tsian wrapper API unless they are intentionally modifying prompt-engine internals.

## Consumer API

Use `assemblePromptFromPreset(input)` from `packages/prompt-engine/src/tsian/assemble.ts`.

Important input fields:

- `preset: PresetInfo`
- `worldBooks?: WorldBook[]`
- `regexScripts?: RegexScriptData[]`
- `history?: ChatMessage[]`
- `macros: Record<string, string>`
- `channel?: "openai" | "text" | "tagged" | "gemini"`
- `view?: "user" | "model"`

The wrapper returns:

- `messages: ChatMessage[] | TaggedContent[]`
- `rendered: string`

## Frontend Rules

- Pass platform/workflow macros as flattened strings. The wrapper does not resolve object paths such as `globals.weather.kind`; callers must compute those values before passing `macros`.
- Use `view = "model"` for prompts sent to LLMs. Use `view = "user"` only for player-facing transformations.
- Preserve prompt preset and world book payload shapes from `@tsian/contracts` resource records.
- Treat `rendered` as debug/display output, not as the source of truth for model calls when structured `messages` are available.

## Avoid

- Do not call core pipeline modules directly from platform-web unless the task is specifically about prompt-engine internals.
- Do not pass browser state objects, Vue refs, or Dexie records directly; extract plain prompt-engine payloads first.
- Do not assume `text` channel returns the same message shape as `openai` or `gemini`; it returns a single user message containing merged text.
