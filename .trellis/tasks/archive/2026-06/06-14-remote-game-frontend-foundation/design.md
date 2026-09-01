# Game Card And Remote Frontend Foundation Design

## Parent Architecture

The foundation has four product concepts:

- **Game Card**: reusable AIRP game template with manifest, workspace template, custom frontend binding, default Agents/Skills/world/state/frontend data, and optional assistant Agent.
- **Save Instance**: playable copy created from a game card. Runtime turns mutate this save's workspace, history, memory, state, session transcripts, trace files, and checkpoints.
- **Checkpoint**: rollback point inside one save instance.
- **Platform Shell**: fixed Tsian UI for lifecycle management. It loads and bridges the game-card frontend but does not render gameplay semantics.

The parent design intentionally splits work into child tasks. Children own implementation details; this parent owns consistency.

## Child Boundaries

### Game Card Library And Save Instance Model

Owns contracts and local persistence:

- `GameCardManifest`;
- local `gameCards` table or equivalent storage;
- save record association to `gameCardId` / `gameCardVersion`;
- built-in blank card;
- create-save-from-card helper;
- initial checkpoint creation for card-derived saves.

### Workspace Assistant Agent Template

Owns the official assistant template:

- `agents/studio-assistant/AGENT.md`;
- `notes.md` and `session.jsonl`;
- manifest/default convention pointing to the assistant Agent;
- docs explaining it becomes ordinary workspace content after card creation.

### Remote Iframe Frontend Bridge

Owns frontend runtime loading:

- active game card frontend resolution;
- sandbox iframe lifecycle;
- permissive common-web URL policy;
- postMessage bridge handshake/RPC;
- allowed bridge methods;
- ordinary workspace read/write/delete;
- checkpoint restore;
- turn-ready events.

### Game Card Import Export Package Format

Owns later distribution mechanics:

- package serialization shape;
- manifest/workspace template/cover/assets inclusion;
- validation and versioning;
- conflict handling;
- future workshop/library integration hooks.

This child is intentionally deferred until the local game card model stabilizes.

## Cross-Child Decisions

- Game frontends are custom and game-card-owned, not selected from a fixed platform generic frontend set.
- Remote webpage loading is the primary frontend development path.
- URL filtering should be permissive; iframe isolation and bridge boundaries do the real work.
- Remote frontend workspace writes/deletes are allowed and immediate through existing platform action semantics.
- `.tsian/*` remains platform metadata and is not ordinary workspace content.
- Raw AI debug records are platform/studio material and should not be exposed to arbitrary remote game frontends by default.
- The assistant Agent is not a hidden platform persona. The platform may provide templates and UI, but the active assistant is workspace/card content.

## Compatibility

The current `official-default` frontend can remain as a built-in blank card fallback and development safety net. This is compatibility, not the final product model.

Existing contentless saves may be handled by:

- associating them with the built-in blank card lazily; or
- letting PlayView fall back to `official-default` when no game card binding exists.

Child tasks should choose the least disruptive path while preserving the new model for all newly created card-derived saves.

## Parent Rollback

If a child task proves too broad, split it further rather than collapsing the model back into old sessions.

If remote iframe bridge work blocks, keep local game card/save model progress and defer only the frontend bridge child.
