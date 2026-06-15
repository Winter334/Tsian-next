# Game Card And Remote Frontend Foundation

## Goal

Plan and track the foundation needed before designing the new Tsian UI around game cards instead of the old fixed workflow-era session UI.

The full target is:

- game cards are local/distributable workspace package templates;
- save instances are playable copies of game cards;
- checkpoints are rollback points inside one save instance;
- game cards provide the player-facing game frontend, remote-webpage first;
- remote game frontends run in sandboxed iframe-like isolation and use a thin bridge;
- remote game frontends can read/write/delete ordinary workspace files for play and development ergonomics;
- the workspace assistant Agent is copied workspace content, not a hidden platform persona;
- import/export package format is remembered as a later child, not forgotten.

This parent task owns the roadmap and cross-child consistency. Implementation should happen in child tasks.

## User Value

- Future lobby/library/workshop/studio UI can be designed around the correct product model.
- Different AIRP games can differ in Agent teams, Skills, world/state conventions, assistant behavior, and game UI.
- Game authors can develop frontends as normal remote web apps while Tsian keeps platform API keys, storage lifecycle, checkpoint, and model calls behind a bridge.
- Deferred package import/export stays visible without bloating the first implementation slice.

## Confirmed Facts

- Current `PlayView` directly mounts `official-default` through an in-process object bridge.
- Existing docs already say frontend packages own gameplay UI and may evolve to iframe/postMessage bridge.
- Current storage has save-scoped tables but no local game card library.
- Current checkpoint records snapshot, history, and workspace files for one save.
- Current workspace has `frontend/README.md` and `frontend/view-state.json`, but no game card manifest or remote frontend binding.
- Current frontend bridge already exposes immediate `workspace-write` and `workspace-delete` platform actions; Agent Runtime turn writes are staged separately.
- The user wants game frontends supplied by game cards, not a fixed platform-generic frontend picker.
- The user wants remote webpages as the primary frontend loading path.
- The user wants a permissive remote URL policy, relying primarily on iframe isolation and bridge boundaries rather than HTTPS-only filtering.
- The user wants remote game frontends to be able to write ordinary workspace files.
- The user approved adding a minimal local game card library in the first foundation slice instead of using save-only manifests.
- The user wants import/export package format tracked as a later child task, not included in the first implementation slice.

## Child Roadmap

1. **Game Card Library And Save Instance Model**
   - Task: `.trellis/tasks/06-14-game-card-library-save-model`
   - Status: completed 2026-06-14
   - Scope: game card contracts, local `gameCards` storage, save-to-card association, built-in blank card, create save instance from card workspace template.
   - Output: a durable local model that future lobby/library/workshop UI can consume.
   - Ordering: first implementation slice.

2. **Workspace Assistant Agent Template**
   - Task: `.trellis/tasks/06-14-workspace-assistant-agent-template`
   - Status: completed 2026-06-14
   - Scope: official `studio-assistant` template as ordinary workspace/card files and assistant manifest convention.
   - Output: new game cards/workspaces contain a customizable assistant Agent by default.
   - Ordering: can be implemented with or immediately after the game card model.

3. **Remote Iframe Frontend Bridge**
   - Task: `.trellis/tasks/06-14-remote-iframe-frontend-bridge`
   - Scope: active game card frontend resolution, sandbox iframe loader, permissive URL policy, postMessage bridge, ordinary workspace read/write/delete, checkpoint restore, turn-ready events.
   - Output: active game card remote frontend can run as the game body through bridge APIs.
   - Ordering: after the game card model exposes active frontend binding.

4. **Game Card Import Export Package Format**
   - Task: `.trellis/tasks/06-14-game-card-import-export-package-format`
   - Scope: package file/export/import format for game cards, cover/assets/workspace template serialization, validation, versioning, and conflict handling.
   - Output: future warehouse/workshop flows can move game cards between machines/accounts.
   - Ordering: deferred until local game card model and remote frontend binding are stable.

## Requirements

- Treat this task as a parent roadmap, not the direct implementation target.
- Keep UI pages such as final lobby, workshop, library, workspace studio, and assistant chat out of this parent unless a later child explicitly scopes them.
- Keep platform fixed UI separate from game-card-provided game frontend.
- Keep game frontend rendering semantics private to the game card and its workspace conventions.
- Preserve the platform boundary around API keys, IndexedDB, platform-host objects, checkpoint lifecycle, and model calls.
- Update active docs/specs as child tasks make contracts authoritative.

## Acceptance Criteria

- [x] Parent roadmap distinguishes game card, save instance, checkpoint, remote frontend, workspace assistant, and import/export package format.
- [x] Parent task links child tasks for local game card model, remote iframe bridge, workspace assistant template, and import/export package format.
- [x] First implementation slice is selected: Game Card Library And Save Instance Model.
- [x] Import/export package format is explicitly deferred into a child task rather than hidden or forgotten.
- [x] Each active child PRD contains testable acceptance criteria before implementation.
- [ ] Completed child tasks update active docs/specs when contracts become authoritative.
- [ ] Parent is not archived until the selected child roadmap is either completed or explicitly deferred with reasons.

## Out Of Scope For This Parent

- Final platform UI design and implementation.
- Account system, workshop backend, moderation, and upload/download services.
- Generic renderer DSL or platform-owned gameplay UI.
- Same-realm execution of downloaded game frontend code.
- Treating checkpoint as the top-level save/card abstraction.

## Open Questions

- None currently blocking the parent roadmap.

## Resolved Questions

- First remote frontend URL policy should allow common remote webpages including public `http://`; isolation and bridge capability limits are the real boundary.
- Remote game frontends should be allowed to read/write/delete ordinary workspace files through the bridge for play and development ergonomics.
- First implementation should add a minimal local game card library instead of relying on save-only manifests.
- Import/export package format should be tracked as a later child task, not included in the first implementation slice.
