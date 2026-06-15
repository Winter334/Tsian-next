# Game Card Import Export Package Format Design

## Architecture And Boundaries

This child completes the local distribution slice for Game Cards. A Game Card package is a reusable template artifact; it is not a Save Instance export and must not include save history, checkpoints, runtime traces, or player-evolved workspace state unless a future save-export task explicitly defines that format.

The first package artifact should be a zip file, conventionally named `*.tsian-card.zip`. Zip is the best first fit because it gives players and future workshop flows one file to upload/download while still preserving a directory-like layout for workspace files and built frontend assets.

Tsian should import and export already-built frontend packages. The platform must not run npm installs, framework builds, Vite plugins, or source compilation in the browser. Author workflow is:

- development: run the game frontend as a separate web app on any available URL/port and use `frontend.kind === "remote"`;
- distribution: build the game frontend into static files and include them under `frontend/` in the game card package.

## Package Layout

Recommended zip layout:

```text
game-card.json
workspace/
  agents/...
  skills/...
  state/...
  frontend/...
frontend/
  index.html
  assets/...
cover/
  cover.png
```

`game-card.json` is the package manifest and should be versioned independently from the game card manifest:

- package schema: `tsian.game-card.package.v1`;
- embedded game card manifest: existing `GameCardManifest`;
- optional indexes for workspace files, packaged frontend files, and cover assets;
- optional package metadata such as exportedAt and exporter version.

The embedded `GameCardManifest.frontend` remains authoritative. Supported frontend bindings after this task:

- `builtin`: built-in platform frontend such as `official-default`;
- `remote`: development or hosted webpage URL;
- `packaged`: static files included in the package, with `entry` pointing to a file under `frontend/`, normally `frontend/index.html`.

## Storage Model

Current local game cards store:

- manifest;
- workspace template files;
- source/createdAt/updatedAt metadata.

Packaged frontend assets are not ordinary Runtime Workspace files. They are part of the reusable Game Card template and are loaded by the platform shell. Store them beside the game card record, not inside save workspaces. Saves created from a card continue to receive only the workspace template files; the active frontend binding is resolved from the card.

Because frontend assets can be binary, local storage should support Blob or ArrayBuffer records with media type and size metadata. Workspace template files can stay text-based.

## Packaged Frontend Loading

Packaged frontends must run in an iframe and use the same `tsian.play-bridge.v1` postMessage bridge as remote frontends. They must not run in the platform JS realm.

A plain `iframe srcdoc` is not sufficient for ordinary built frontend outputs because relative assets, module chunks, CSS URLs, fonts, and images need stable browser-loadable URLs. The preferred first implementation is:

1. store packaged frontend files in IndexedDB;
2. register a same-origin Service Worker or equivalent virtual resource layer;
3. load the iframe at a stable virtual URL such as `/__tsian_game_card_frontends/<cardId>/index.html`;
4. have the virtual resource layer serve files for that card from IndexedDB with the recorded media type.

Remote and packaged frontends should share the same remote bridge adapter after iframe creation. The difference is URL resolution and file serving. Both remote and packaged iframe frontends use the compatibility-first sandbox from the remote-iframe child: `allow-scripts allow-same-origin allow-forms`.

Packaged frontends currently need `allow-same-origin` because the first browser-local virtual resource layer is Service Worker + IndexedDB. Without same-origin iframe clients, sandboxed opaque-origin navigations bypass the controlling Service Worker and cannot receive the stored package files. A later isolated asset origin or full asset-rewrite loader can revisit a stricter packaged sandbox.

## Validation

Import validation should reject packages with:

- missing or unsupported package schema;
- missing game card manifest;
- malformed manifest required fields;
- unknown frontend binding kind;
- packaged frontend binding without a matching entry file;
- path traversal, absolute paths, empty paths, duplicate paths, or unsafe control characters;
- files outside allowed top-level roots for the package version;
- unexpectedly large package/file sizes once limits are defined in code.

Workspace template files may include platform-provided `.tsian/*` defaults when exported from an existing local game card, but ordinary frontend/runtime bridge methods must continue hiding `.tsian/*` from game frontends and Agents where already required.

## Conflict Behavior

First implementation should be simple and explicit:

- importing a new id creates a local imported game card;
- importing the same id and same version replaces the reusable game card template only after validation;
- importing the same id with a new version updates the reusable game card record;
- existing Save Instances are not mutated when a card is imported or updated;
- source should become `imported` unless the record is the built-in blank card, which should not be overwritten by package import.

Future UI can add richer conflict prompts, duplicate-as-copy, author signing, or workshop moderation.

## Export Behavior

Export serializes a local Game Card into `*.tsian-card.zip`:

- include `game-card.json`;
- include workspace template files under `workspace/`;
- include packaged frontend files under `frontend/` when the card has packaged assets;
- include cover assets when stored locally;
- do not include Save Instance snapshot/history/checkpoints/workspace mutations.

Remote frontend bindings can be exported as manifest metadata without embedding remote content.

## Rollback

If packaged frontend loading proves too broad for this slice, keep the zip package contract and import/export for manifests/workspace/remote bindings, then defer only the local packaged frontend resource serving. Do not collapse Game Cards back into Save Instances.
