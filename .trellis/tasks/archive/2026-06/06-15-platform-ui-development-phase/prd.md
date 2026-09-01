# Platform UI Development Phase

## Goal

Turn the completed Agent Runtime / Game Card / Runtime Workspace foundation into a usable platform UI phase.

This parent task owns the UI roadmap and cross-child acceptance criteria. Implementation should happen in child tasks that can be planned, verified, and archived independently.

## User Value

- Players and authors can manage Game Cards, Save Instances, settings, diagnostics, workspace files, Agents, and Skills through the platform instead of only through debug surfaces.
- The platform has a visually memorable RetroOS desktop home that can later accommodate account identity, online services, and high-frequency shortcuts without becoming a traditional persistent navigation bar.
- Players can start or continue play from the home screen when a playable Game Card / Save Instance is available, while deeper management lives in dedicated library and detail pages.
- Future default game frontend work can plug into a coherent Game Card and frontend-binding UI rather than recreating legacy same-realm defaults.
- UI work can proceed without reopening foundation questions that have already been settled: no old workflow editor, no prompt preset mainline, no platform-level gameplay renderer, and no built-in same-realm game frontend.
- Each UI slice can be shipped safely with focused validation instead of one large unreviewable rewrite.

## Confirmed Facts

- Current active direction is Agent-Orchestrated AIRP Runtime.
- `apps/platform-web` currently has route views for lobby, settings, play, and debug.
- `/play` is now a thin frontend loader for `remote` or `packaged` Game Card frontends. Game Cards may temporarily omit `frontend`; `/play` shows a not-configured error.
- The same-realm `official-default` builtin game frontend has been removed.
- Current implementation treats Game Cards as reusable Runtime Workspace templates and creates Save Instances by copying template workspace files into save-scoped workspace files.
- This current implementation conflicts with the emerging product direction under discussion: Agent/Skill/schema/rule/frontend-definition content should belong to the Game Card itself, while Save Instances should hold runtime play data such as generated NPCs, dialogue/history, maps, relationships, memory, and other system state.
- Game Card package import/export exists for `.tsian-card.zip`, including `workspace/*` and optional built `frontend/*` files.
- Runtime Workspace storage, checkpoint, history, traces, diagnostics, Agent registry, Skill registry, Skill detail, Agent context, and workspace tools exist at the bridge/platform-host layer.
- Existing UI is still mostly foundation/debug UI: lobby is session-oriented, settings only covers chat model config, debug is raw observability, and there is no full card library, workspace studio, Agent/Skill studio, assistant UI, or default packaged frontend.
- Desired UX direction: use a Tsian RetroOS design language inspired by classic Windows desktop UX. The home page should feel like an operating-system desktop with shortcuts and quick actions, not a conventional sidebar/topbar shell; Game Cards should be browsed in a dedicated card-library window and edited through a Game Card detail/properties surface.
- Project specs require `npm run build:web` for platform-web changes, `npm run build:contracts` for contract changes, and `npm run build:runtime-core` when runtime-core changes.

## Child Roadmap

### Current Alignment

The UI direction pivoted after the initial child roadmap was created. The current product direction is now the archived `06-16-retroos-multi-window-desktop-shell`: a real RetroOS multi-window desktop shell with desktop icons, application windows, taskbar entries, window focus/minimize/close behavior, and `/play` as a desktop application window.

Keep child tasks whose product goal is independent of the shell's visual style. Retire or merge tasks whose goal was replaced by the multi-window shell pivot.

### Completed / Superseded Children

1. `06-15-card-owned-content-save-runtime-data-model` — completed.
   - Result: Game Cards own reusable content; Save Instances own runtime data; effective workspace combines card content plus selected save data at `save/...`.

2. `06-15-game-card-library-save-flow-ui` — completed.
   - Result: My Apps, Game Card launcher/detail, Save Instance creation/selection/deletion, App Market placeholder, and player-first card detail entry points.

3. `06-16-generic-workspace-authoring-tools` — completed.
   - Result: generic workspace operations for list/search/read/diff/patch/write/move/delete/validate across card-content, save-runtime, and platform-meta scopes.

4. `06-16-retroos-multi-window-desktop-shell` — completed.
   - Result: current RetroOS desktop shell direction and route/window model.

5. `06-15-platform-shell-navigation-ui` — superseded; archive instead of continuing as a direct implementation target.
   - Reason: its original home-hub / page-wayfinding scope was overtaken by the multi-window RetroOS desktop shell. Any remaining shell polish should be tracked as focused follow-up work, not by resurrecting the old home-navigation task.

### Remaining Active Children

1. `06-15-runtime-workspace-studio-ui`
   - Boundary: Runtime Workspace browse/read/search/write/delete UI for ordinary workspace files.
   - Output: authors can inspect and edit card-owned content and, when scoped by a save, runtime save data through the platform.
   - Alignment note: keep this task. Update its PRD to start from the current folder-browse prototype, current card/save effective workspace model, and generic workspace authoring tools.

2. `06-15-agent-skill-assistant-studio-ui`
   - Boundary: Agent registry, Agent context, Skill registry, Skill detail, Studio Assistant entrypoint.
   - Output: authors can inspect and manage Agent/Skill/assistant content as workspace-owned material.
   - Alignment note: keep this task, but keep the first UI lightweight and player-readable. Assistant chat should become a separate desktop app bound to the currently loaded Game Card rather than a dense panel inside Studio.

3. `06-15-game-card-package-frontend-binding-ui`
   - Boundary: `.tsian-card.zip` import/export, remote frontend URL binding, packaged frontend visibility, frontend-not-configured handling.
   - Output: users can bring in or configure a playable frontend without editing storage manually.
   - Alignment note: keep this task. Entry points should live in App Market and the Game Card detail Frontend tab.

4. `06-15-runtime-diagnostics-settings-ui`
   - Boundary: model settings, runtime diagnostics, trace summaries, history/checkpoints/snapshot, debug data presentation.
   - Output: runtime behavior is understandable without raw JSON-only debug pages.
   - Alignment note: keep this task. Update its PRD to target Control Panel / System Monitor style surfaces in the current desktop shell.

5. `06-15-default-packaged-game-frontend`
   - Boundary: later default playable frontend package and blank-card frontend binding.
   - Output: built-in blank Game Card can become playable through the same `packaged` frontend path as any other Game Card.
   - Ordering note: intentionally later than core platform management UI unless the user reprioritizes it.
   - Alignment note: keep this task but leave it low priority until package/frontend binding and management UI are stable.

## Requirements

- Treat this as a parent roadmap and integration task, not the direct implementation target.
- Keep child tasks independently verifiable.
- Preserve current platform boundaries: platform owns model calls, storage, bridge, checkpoint, package loading, and diagnostics; Game Cards and frontends own gameplay UI and rendering semantics.
- Resolve the card-owned content vs save-owned runtime data model before implementing Workspace Studio or deep Game Card detail editing.
- Do not restore retired workflow editor, prompt preset UI, mod/resource surfaces, event/archive platform tables, or generic renderer DSL.
- Do not reintroduce same-realm built-in game frontends.
- Prefer existing UI primitives under `apps/platform-web/src/components/ui/`.
- Make the home page visually distinctive and navigation-oriented as a Tsian RetroOS desktop, but keep it functional: quick start, continue, library entry, settings, diagnostics, and future account affordances should be reachable as desktop/start-menu-style actions rather than static marketing copy.
- Avoid a traditional persistent navigation bar as the primary IA. Use the home page as the main hub, with page-level back/breadcrumb/context actions inside deeper surfaces.
- Borrow proven classic Windows UX patterns where they reduce product-design burden: desktop shortcuts, start-menu-like launch affordances, Explorer-like resource management, properties/detail dialogs, control-panel settings, status bars, menu bars, tabs, and explicit confirmation dialogs.
- Use the RetroOS treatment as a visual and interaction metaphor, not as a requirement to build a fully draggable overlapping-window manager in the first UI slices. Route-backed pages may present as windows while keeping navigation and state simple.
- Keep management pages operational and dense enough for repeated use; avoid turning Game Card detail, workspace, Agent/Skill, settings, or diagnostics surfaces into marketing-style pages.
- Update active docs/specs when UI work makes a contract or convention authoritative.
- Run required builds and focused browser smoke checks for each child.

## Acceptance Criteria

- [ ] Parent task records the UI phase goal, scope, child roadmap, ordering, and cross-child constraints.
- [ ] Each child task has an initial PRD with testable acceptance criteria.
- [ ] The first implementation slice is selected after user review.
- [ ] Home page works as a Tsian RetroOS desktop navigation hub with quick start/continue and route entry points.
- [ ] Game Card Library shows Game Cards as cards and links to a Game Card detail surface for full editing/management.
- [ ] Complex child tasks receive `design.md` and `implement.md` before `task.py start`.
- [ ] UI work does not depend on the removed builtin `official-default` frontend.
- [ ] UI work uses Game Card optional frontend semantics correctly.
- [ ] Parent is not archived until all children are completed or explicitly deferred with reasons.
- [ ] Active docs/specs are updated as UI contracts become authoritative.

## Out Of Scope For This Parent

- Implementing every UI surface directly in the parent task.
- Account system, online workshop backend, moderation, cloud sync, or upload services.
- Reintroducing old workflow/prompt/event/archive surfaces.
- Platform-owned gameplay renderer DSL.
- Making a default game frontend before the core platform management flow is chosen, unless the user explicitly changes priority.

## Open Questions

- None for current planning.

## Resolved Questions

- The blank built-in Game Card may remain frontend-less for now.
- A future default game frontend should be `remote` or `packaged`, not a same-realm builtin path.
- Parent/child task structure is desired for the UI phase.
- The platform should not use a conventional persistent navigation bar as its primary UX. The home page should be a visually memorable navigation hub with quick actions and future account-system affordances.
- The platform UI design language should pivot to Tsian RetroOS: a retro desktop operating-system metaphor inspired by classic Windows UX. This replaces the previous dark cyber/terminal visual direction as the preferred UI phase style.
- The RetroOS direction should borrow Windows-like UX patterns to reduce invention burden, but first implementation slices should not require a real draggable multi-window desktop.
- Game Card management should use a card-based library page and a Game Card detail page where save management, workspace studio, frontend binding, and related editing surfaces can live.
- Game Card Library should be cover-first and minimal: resting cards show only cover/fallback art; selected/hovered cards reveal name and short summary overlay.
- Game Card Detail should be player-first: poster-like cover/description/author presentation on the left, Save Instance management on the right, and local navigation to deeper editing surfaces.
- Workspace Studio should be a full-screen resource-manager style surface with file-editing dialogs.
- Game Card content changes should affect existing saves for that card. This matches the model where the card is the game itself and saves store only runtime play data.
- Save Instances should feel like mainstream game saves: under a larger save directory, each save slot/file/directory represents one playthrough and contains that playthrough's runtime data.
- Runtime-facing effective workspaces should expose the selected save slot at `save/...`; broader management UI may show all slots under `saves/<save-id>/...`.
- First implementation slice is `06-15-card-owned-content-save-runtime-data-model`, before deep Game Card detail, Workspace Studio, or Agent/Skill Studio. A thin home hub can still be built independently later if useful.
- The desktop should use one currently loaded Game Card context, not simultaneous multi-card loading.
- The Game Card loader should choose/import/manage/load cards; after loading, desktop apps operate against that current card by default.
- The current card does not need a separate desktop status banner. The game entry icon/title/cover can carry that context.
- Assistant should be a desktop chat app that reads the current Game Card's assistant configuration.
- Agent/Skill Studio should stay lightweight and understandable, presenting roles and abilities before technical registry details.

## Product Decisions To Resolve

- None for current planning.
