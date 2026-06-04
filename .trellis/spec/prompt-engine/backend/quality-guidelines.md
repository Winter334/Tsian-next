# Quality Guidelines

Prompt-engine changes should preserve round-trip compatibility with real preset data and keep the pipeline modular.

## Required Checks

- Run `npm run build:prompt-engine`.
- Run `npm run test:prompt-engine` for behavior changes.

## Review Checklist

- If conversion changes, add or update fixture coverage in `packages/prompt-engine/test/`.
- If `PresetInfo`, `WorldBook`, or `RegexScriptData` changes, check `packages/contracts/src/preset.ts` and consuming platform resource code.
- If channel output changes, verify `assemblePromptFromPreset` still returns both `messages` and `rendered`.
- If variable macros change, verify both `{{}}` and `<<>>` syntaxes when relevant.
- If world book activation changes, verify keyword, always, vector callback, probability, and recursion behavior.

## Local Patterns

- Compatibility defaults are centralized in conversion helpers, not spread across pipeline modules.
- `buildPrompt` returns staged debug views: tagged, internal, output, and per-item stages.
- The Tsian wrapper defaults to `channel = "openai"` and `view = "model"`.

## Avoid

- Do not bypass `buildPrompt` from the Tsian wrapper.
- Do not add global mutable state to prompt assembly. Variables are passed through `VariableContext`.
- Do not add dependencies on platform-web or workflow-engine.
