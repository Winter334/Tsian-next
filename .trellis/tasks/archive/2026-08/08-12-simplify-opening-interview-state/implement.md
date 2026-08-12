# Implementation Plan

## 1. Replace progress actions with native notes

- [ ] Delete progress CAS helpers/read/advance actions and their raw-import registrations.
- [ ] Rewrite the Skill around optional `save/playthrough/opening-notes.md` maintenance through native `read/write`.
- [ ] Confirm world-architect’s existing `workspace_read/workspace_write` and level 1 access are sufficient; add no new capability or custom Tool.

## 2. Simplify frontend interview control

- [ ] Remove attempt/revision/receipt fields and parsers from `opening-interview.ts`.
- [ ] Remove progress loading and exact turn confirmation from `useSetupState.ts`.
- [ ] Restore successful dialogue directly from transcript and keep only same-page retry state for failed calls.
- [ ] Add bounded trailing-unclosed `[[开局选项]]` tolerance.

## 3. Reduce final commit to operational checks

- [ ] Remove the session envelope and progress ready/CAS dependency.
- [ ] Remove duplicate `issues[]` validation and speculative deep checks.
- [ ] Keep safe writes, actual runtime/ref/frontier/reply requirements, clean-save protection and transaction atomicity.
- [ ] Derive names/source metadata/order fields rather than rejecting repairable differences.
- [ ] Make already-complete calls return a no-op completion without payload-hash revision matching.

## 4. Synchronize documentation and sources

- [ ] Update workspace README and any action/error references.
- [ ] Update Trellis specs that currently prescribe opening progress revision/attempt correlation.
- [ ] Confirm platform raw imports point only to the new card workspace action files.

## 5. Verification

- [ ] Add or extend focused retained smoke coverage for notes/commit behavior and zero-write failure.
- [ ] Cover unclosed opening choices and successful response without note update.
- [ ] Run `npm run build:play-frontend`.
- [ ] Run `npm run build:web`.
- [ ] Run `npm run test:smoke:web`.
- [ ] Run `npm run package:card`.
- [ ] Run `git diff --check` and stale-field greps for `basedOnRevision`, `processedAttemptId`, opening `revision/receipt`, and `OPENING_COMMIT_INVALID` issue collection.
- [ ] Leave full browser interaction testing to the user.

## Risk and rollback

- Main risk: relaxing checks that a downstream consumer actually needs. Mitigate by grounding retained checks in frontend parser/context-injection/frontier consumers and focused smoke cases.
- The workflow is test-only and old sessions are disposable, so schema replacement does not need dual-read compatibility.
- Roll back as one opening-domain change (Skill/scripts/frontend/spec); generic transcript/context code is untouched.
