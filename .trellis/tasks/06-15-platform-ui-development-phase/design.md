# Platform UI Development Phase Design

## Architecture

The UI phase should treat `apps/platform-web` as the platform app and keep `/play` as the game-frontend mount point.

The platform app owns:

- a visually memorable home navigation hub;
- route layout and page-level wayfinding;
- Game Card and Save Instance lifecycle UI;
- package import/export and frontend binding configuration;
- Runtime Workspace inspection and authoring tools;
- Agent, Skill, and assistant management views;
- settings, diagnostics, trace, checkpoint, and debug views.

Game frontends own:

- player-facing gameplay interface;
- interpretation of gameplay-specific workspace files;
- rendering of runtime-produced state.

## Current Route Shape

- `/` -> `LobbyView.vue`
- `/settings` -> `SettingsView.vue`
- `/debug` -> `DebugView.vue`
- `/play` -> `PlayView.vue`, no platform shell, thin loader only

The UI phase should evolve `/` from a session lobby into a home navigation hub. The app can add routes during child tasks, but `/play` should remain unframed and focused on the active frontend.

## Information Architecture Direction

The primary IA should not be a conventional persistent sidebar or top navigation bar. The home page should act as the main hub:

- strong first-viewport identity for Tsian;
- quick start and continue actions when a playable Game Card / Save Instance is available;
- entry points to the Game Card library, settings, diagnostics, and future account/profile surfaces;
- honest empty states when no card, save, frontend, or AI config is available.

Deeper pages should use local wayfinding instead of a global nav dependency:

- page title, status, and contextual actions;
- back-to-home or breadcrumb-style return affordances;
- tabs or segmented sections inside complex detail pages;
- direct links between related surfaces, especially Game Card detail, Save Instance management, workspace files, frontend binding, and diagnostics.

## Core User Flow

The preferred management flow is:

`Home -> Game Card Library -> Game Card Detail -> Save / Workspace / Frontend / Agent-Skill sections -> Play`

The home screen may offer shortcuts into `Play`, but full editing and management should converge on the Game Card detail surface.

## Player-First Game Card UX

Game Card browsing should favor player choice over authoring metadata:

- library cards normally show only the cover image or cover fallback;
- when a card is hovered/focused/selected, the cover gains an overlay with the card name and a short summary that may be visually truncated;
- library cards should not show extra metadata, status tables, ids, version strings, or editor controls by default;
- selecting/clicking a card opens its detail page.

The Game Card detail page should be player-first but editor-capable:

- use local page navigation/tabs inside the detail page;
- first screen is split between a poster-like cover presentation and save management;
- the left side should let the cover dominate like a poster, with readable title, full untruncated description, author, and related card information overlaid toward the lower area of the image;
- the right side owns Save Instance management: continue, create, select, delete, and playable/not-playable states;
- authoring surfaces such as Workspace Studio, frontend binding, Agent/Skill, and diagnostics are reachable through detail navigation rather than competing with the first screen.

Workspace Studio should feel like a full-screen resource manager:

- it is reached from Game Card detail navigation and is scoped by the selected card/save context;
- it should use a familiar file-browser layout similar to Windows Explorer: directory tree or path navigation, file list, search/filter, and file actions;
- opening a file launches an editing modal/dialog so the user edits content like a document without losing the resource-manager context;
- the studio remains generic and file-based, not gameplay-schema-specific.

## Card Content And Save Data Direction

The emerging product direction is to make Game Cards own definition content and Save Instances own runtime data.

In this model, Game Card content includes:

- Agent definitions such as `agents/<agent>/AGENT.md`;
- Skill definitions and resources such as `skills/*` and `agents/<agent>/skills/*`;
- schemas, rules, author documentation, canonical world setup, and frontend-facing data definitions;
- packaged/remote frontend binding and card metadata.

Save Instance data includes:

- player dialogue and history;
- generated NPCs and other AI-created runtime entities;
- maps, relationships, memory, current scene, frontend view state, and other evolving system data;
- checkpointable runtime state.

The runtime should eventually read an effective workspace assembled from both layers:

`effective workspace = card-owned content + selected save runtime data`

This differs from the current implementation, where save creation copies the whole Game Card workspace template into save-scoped workspace files. The UI should not deepen reliance on that copy model until the product direction is resolved.

Card content edits should affect existing saves for that card. This matches mainstream game behavior: patching or editing the game content changes what existing save files run against, while the save file keeps the playthrough's generated state.

Save Instances should be modeled like save slots under a larger save directory. Each save slot/file/directory represents one playthrough and contains only that playthrough's runtime data. The exact user-facing and runtime-facing mount path still needs a naming decision.

If adopted, Workspace Studio should make the distinction productive rather than confusing:

- card detail authoring edits card-owned content;
- save-scoped views inspect or edit runtime data for the selected save;
- runtime Agents and Skills read card definitions and write runtime data by default;
- checkpoint/export semantics distinguish card package content from save runtime data.

## Child Boundaries

### Platform Shell Navigation UI

Owns the home navigation hub and page-level wayfinding that all later UI children plug into. It should settle page names, hub actions, future account affordance placement, active context summary, and empty-state language.

### Game Card Library And Save Flow UI

Owns the first user-facing product model:

`Game Card -> Save Instance -> Play`

It should provide a minimal cover-first Game Card library and a player-first Game Card detail surface. It should surface frontend-less cards honestly and let users create/select/delete saves without implying there is a default playable frontend.

### Game Card Package And Frontend Binding UI

Owns author/player entry points for local packages and frontend bindings. It should reuse existing storage/package helpers and keep validation at storage/platform boundaries.

### Runtime Workspace Studio UI

Owns ordinary workspace file UI. It should be a full-screen resource-manager style workspace with document-like edit dialogs. It must respect `.tsian/*` platform metadata rules and avoid gameplay-specific semantics.

### Agent Skill And Assistant Studio UI

Owns Agent/Skill/assistant management as workspace content. It should consume `agent-registry`, `agent-context`, `skill-registry`, and `skill-detail` rather than duplicating parsers in Vue components.

### Runtime Diagnostics And Settings UI

Owns platform observability and settings. It should make current debug resources usable without exposing them to arbitrary remote/packaged game frontends.

### Default Packaged Game Frontend

Owns later playable default UI. It should use the same package/iframe bridge path as imported packaged frontends and bind through the blank Game Card manifest once ready.

## Data Flow

- UI route views call platform-host or storage helper APIs already exposed for platform actions.
- Shared cross-package shapes come from `@tsian/contracts`.
- Runtime Workspace reads/searches/writes go through platform-host/storage helpers and must normalize paths at boundaries.
- Game frontend configuration uses `GameCardManifest.frontend?: GameCardFrontendBinding`.
- Packaged frontend files live beside Game Cards in `gameCardFrontendFiles`, not inside Save workspaces.

## Compatibility

- Prototype IndexedDB reset is allowed by project policy, but child tasks should not introduce migrations without explicit approval.
- Existing frontend-less blank cards and saves must remain inspectable through platform UI.
- `/play` with no active frontend should remain a clear error state until the default packaged frontend child changes that behavior.

## Design Constraints

- The home page may be visually dramatic and brand-forward, as long as it remains a functional navigation and quick-action surface rather than a static marketing page.
- Preserve the dark cyber/terminal lineage as a starting point, but allow the home page to become more cinematic than management surfaces.
- Prefer dense operational UI for library, detail, workspace, Agent/Skill, settings, and diagnostics pages.
- Do not rely on a traditional persistent nav bar as the primary navigation model.
- Avoid nested cards and oversized hero layouts for platform tools.
- Use existing UI primitives under `components/ui/`.
- Use feature-specific routes or panels only when they clarify repeated work.
- Keep long-running runtime logic out of templates.

## Risks

- UI may accidentally hardcode gameplay semantics into platform surfaces. Mitigation: keep workspace/Agent/Skill UI generic and file/contract-based.
- Debug UI may expose raw AI/debug material to game frontends. Mitigation: keep debug surfaces platform-only.
- Parent task may grow too broad. Mitigation: implement through children and archive/defer independently.
- A visually strong home page may drift into non-functional landing-page composition. Mitigation: require first-screen quick actions and real route entry points.
- Removing persistent navigation may make deep pages feel stranded. Mitigation: require page-level return, breadcrumb, and contextual cross-links.
