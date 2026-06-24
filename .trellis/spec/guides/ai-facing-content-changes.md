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

## Conforming to Training Conventions vs. Forbidding Them

The rule above is about *removing* a concept the model should not think about. A related but opposite case: **the model has a strong training-prior that an input form "just works," and your tool rejects it.** Here the fix is to make the implementation accept the form, not to teach the model to avoid it.

Real example (2026-06-23, `list(".")`): models habitually call `list(".")` to enumerate a workspace root — `.` = root is the convention in Claude/OpenAI file tools and most agent frameworks. The workspace path normalizer rejected `.`/`..` with `WORKSPACE_PATH_INVALID`, so every fresh session wasted a round on an avoidable error: call `list(".")` → read the error → re-call without the dot. A prompt rule "do not use `.`" would fight a strong prior and cost tokens every turn. The fix was to accept `.`/`..` in the normalizer (the runtime workspace is root-bound, so `..` clamps at the root and cannot escape — there is no traversal risk to defend against) and add "or `.`" to the `list` schema description. One behavior change, zero recurring token cost.

**The heuristic**: when the model repeatedly tries a well-known input form and your tool rejects it for a reason that does *not* hold in your context (here: path traversal risk, which a root-bound virtual FS does not have), prefer making the tool accept the form over teaching the model to avoid it. Forbidding a training prior is a per-turn tax; conforming to it is a one-time implementation cost. Only forbid when the rejection guards a risk that is real in your context.

When you do conform, update the schema `description` to name the accepted form (e.g. "Empty, omitted, or `.` means the workspace root.") so the model's prior is confirmed rather than left to guess. Do **not** describe the resolution mechanism (`..` clamps, segments are resolved on a stack) — that is internal, same as rule 4 above.

---

## Adding a Restriction: The "Would It Happen Anyway?" Test

The rules above are about *removing* a concept the model should not think about. The mirror case is *adding* a new instruction, prohibition, or guardrail to an AGENT.md / SOUL.md / Skill / tool `description`. Before adding one, run this test:

> **If I give no instruction on this (neither "do" nor "don't"), how likely is the agent to do the undesired thing?**

- **Likely** (the model has a training prior toward it, or another existing instruction induces it, or it's the obvious default) → the restriction earns its place. Write it, ideally as a positive redirect ("do X instead") rather than a bare "don't do Y", but write it.
- **Unlikely** (the agent has no built-in motivation toward it; nothing else in the surface suggests it) → **do not add the restriction.** An instruction the agent would never violate on its own has zero upside and real downsides: it consumes tokens every turn, takes attention budget away from the instructions that matter, and — worst — plants a concept in the model's context that it otherwise would never have considered, sometimes *causing* the very behavior you feared (the "don't think of an elephant" effect).

The failure mode is symmetric to the removal case: builds pass, types check, because a redundant instruction isn't a code error. The check is a judgment call, not a grep — ask the question explicitly before writing the line.

Real example (2026-06-24, post-processing turn persistence): the platform runtime already persists every turn to `save/history/turns/` as a raw record, consumed by the semantic index. The post-processing agent's `AGENT.md` *also* instructed it to persist turn output there in a second "canonical" format — a format with no consumer that would corrupt the index. The fix was to **delete the inducing instruction** (the "persist turn output" line), not to add a "do not write turn files" prohibition. Once the inducer was gone, the agent had no motivation to write turn files, so a prohibition would have been a pure cost — tokens, attention, and a reverse-suggestion that puts "write turn files" into the model's head. The first attempt made exactly this mistake (adding `Do NOT write turn files to save/history/turns/`); the correct end state was zero instruction on turn files at all.

**The heuristic**: restrictions are justified by the probability of the undesired action *in the absence of the instruction*, not by the severity of the action if it occurred. A severe-but-improbable outcome still does not justify a restriction the agent would never trigger. Remove the *cause* (the inducing instruction or the missing guard in code) when you can; only add an AI-facing restriction when the cause is the model's own default behavior.

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

When **adding** a restriction / prohibition / guardrail to an AI-facing surface:

- [ ] Asked "would the agent do the undesired thing if I gave no instruction on it at all?"
- [ ] If **unlikely** → did NOT add the restriction; removed the inducing instruction / added the code guard instead?
- [ ] If **likely** → wrote it, preferring a positive redirect ("do X instead") over a bare "don't do Y"?
