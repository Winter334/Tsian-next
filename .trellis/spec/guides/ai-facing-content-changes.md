# AI-Facing Content Changes

> **Purpose**: Avoid leaving residual concept traces when removing or auto-infering a concept from AI-facing surfaces (tool schemas, prompts, descriptions).

---

## The Problem

AI-facing content — JSON tool schemas, system/user prompt strings, tool `description` fields — is different from normal code. For human code, "downgrade and keep" is often polite: you mark a param `optional`, add a `@deprecated` note, keep a back-compat path. **For AI-facing content, downgrade-and-keep is usually the worst state**, because:

- The concept still exists in the surface (the model sees it).
- "Optional / auto-inferred / defaults to X" wording *invites* the model to reason about when to use it — pure decision noise.
- The model may still emit the param, or worse, pick a wrong value because the description spent words explaining a concept it never needed to know.

Real example (2026-06-22, `scope` auto-inference): the task intent was "scope should be auto-inferred, agents don't need to know." The first pass *downgraded* scope from `required` → `optional` and rewrote descriptions to "Scope is optional and defaults to effective." That left 8 tool descriptions still teaching the model about scope — exactly the noise the user wanted gone. The correct end state was: scope absent from `properties`, zero mention in any `description` or prompt. The lesson: **read "auto-infer / don't make the agent think about X" as a removal signal, not a downgrade signal.**

---

## The Rule

When the task is to remove or auto-infer a concept from an AI-facing surface:

1. **Decide intent: downgrade vs remove.**
   - User says "make it optional / loosen / back-compat" → downgrade (keep the surface entry, mark optional).
   - User says "auto-infer / not the agent's concern / adds friction / noise / 徒增麻烦 / 不需要让 agent 知道" → **remove**. The concept should become invisible to the model, as if it never existed.

2. **For a removal, the end state is zero surface trace.**
   - Drop the property from the tool schema `properties` (not just from `required`).
   - Remove every mention of the concept word from all `description` strings and prompt/string literals.
   - Keep the internal implementation (auto-inference function, routing, permission check) — that is not AI-facing.

3. **After the change, run a two-layer grep on the removed concept word:**
   - **Code layer**: confirm no stale *consumer* references (the usual check).
   - **AI-facing text layer**: grep the concept word inside `description:` fields, prompt string literals, and docstrings that end up in prompts. Require **zero hits** in AI-facing surfaces — not "rewritten to be less prominent," zero.
   - Distinguish hits: internal comments / type definitions / routing logic that never reach the model are fine. `description: "...scope..."` or `` `...scope...` `` prompt literals are not fine.

4. **Do not describe the auto-inference mechanism to the model.** "Scope is inferred from the path prefix" is still telling the model about scope. The model only needs the user-facing concept that replaces it (e.g. "use `save/...` for runtime saves"). The mechanism is internal.

---

## Why This Matters

The model's attention is finite. Every concept mentioned in a schema description or prompt is a concept the model will spend tokens considering. A concept that the framework already handles deterministically (scope routing, permission levels, owner resolution) is a concept the model should never see. Leaving a "this is optional / auto / usually X" trace is worse than a clean absence, because it prompts the model to make a decision it isn't responsible for — and occasionally to make it wrong.

The failure mode is silent: builds pass, types check, tests pass, because the residual text isn't a code error. Only a text-layer grep on the concept word catches it. So the grep is mandatory, not optional.

---

## Checklist

When removing / auto-inferring a concept from an AI-facing surface:

- [ ] Intent is **remove** (not downgrade)? → target zero surface trace.
- [ ] Removed the property from schema `properties` (not just `required`)?
- [ ] Grep'd the concept word across all `description:` and prompt string literals?
- [ ] Zero hits in AI-facing text (internal comments / types / routing are exempt)?
- [ ] Replaced any necessary user-facing guidance with the *replacement* concept (e.g. path prefixes), not the mechanism?
- [ ] Internal auto-inference implementation kept (routing, permissions, default resolution)?
