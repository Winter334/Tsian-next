# Game Card Library And Save Instance Model Design

## Scope

This child implements the local foundation for game cards and save instances. It does not load remote iframes yet and does not define import/export package files.

## Contracts

Add a new public contracts module, tentatively `packages/contracts/src/game-card.ts`, and export it through `packages/contracts/src/index.ts`.

Suggested shapes:

```ts
export interface GameCardManifest {
  schema: "tsian.game-card.v1"
  id: string
  name: string
  version: string
  summary: string
  description?: string
  author?: GameCardAuthor
  cover?: GameCardCover
  frontend: GameCardFrontendBinding
  assistant?: GameCardAssistant
}

export type GameCardFrontendBinding =
  | {
      kind: "remote"
      url: string
      bridgeVersion: "tsian.play-bridge.v1"
    }
  | {
      kind: "builtin"
      id: "official-default" | string
    }

export interface GameCardWorkspaceTemplateFile {
  path: string
  content: string
  mediaType?: string
}
```

The `builtin` binding is a compatibility/development fallback so the built-in blank card can preserve the current `official-default` behavior before remote iframe support lands. New custom game cards should prefer `remote`.

The manifest is card metadata and loading configuration. Gameplay state, frontend data, Agent definitions, and Skill definitions remain workspace template files.

## Storage

Current prototype storage uses Dexie and explicitly prefers database-name resets over migrations for schema changes. This child should bump the database name, for example from `tsian-agent-runtime-v3` to `tsian-agent-runtime-v4`, and add a `gameCards` table.

Add `LocalGameCardRecord` to `apps/platform-web/src/storage/db.ts`:

```ts
interface LocalGameCardRecord {
  id: string
  manifest: GameCardManifest
  workspaceTemplateFiles: GameCardWorkspaceTemplateFile[]
  source: "builtin" | "local" | "imported"
  createdAt: number
  updatedAt: number
}
```

Extend `LocalSaveRecord`:

```ts
interface LocalSaveRecord {
  id: string
  name: string
  gameCardId?: string
  gameCardVersion?: string
  createdAt: number
  updatedAt: number
}
```

Use `gameCardId` as the Dexie primary key for game cards. Add indexes useful to future library UI, such as `updatedAt` and `source`.

## Storage Helpers

Add `apps/platform-web/src/storage/game-cards.ts` for game card operations:

- `listLocalGameCards()`
- `getLocalGameCard(cardId)`
- `putLocalGameCard(input)`
- `ensureBuiltinBlankGameCard()`
- `getBuiltinBlankGameCard()`

Keep helpers serializable and storage-owned. Do not import Vue or platform-host.

The built-in blank game card should be seeded from the existing default workspace template. If needed, export a helper from `workspace.ts` that returns cloned default template files as `GameCardWorkspaceTemplateFile[]`, rather than duplicating default workspace arrays in multiple files.

## Save Creation

Add a new save helper in `storage/saves.ts`:

- `createLocalSaveFromGameCard(card, input?)`

Flow:

1. Normalize initial empty runtime snapshot and history.
2. Create `LocalSaveRecord` with `gameCardId` and `gameCardVersion`.
3. Convert the card workspace template files into save-scoped workspace records.
4. Write save, snapshot, history, workspace files, and initial checkpoint in one Dexie transaction where practical.
5. Use the initial checkpoint label `初始状态` to preserve current behavior.

The current `createLocalSave()` can become a compatibility wrapper that ensures the built-in blank game card and delegates to `createLocalSaveFromGameCard()`. This preserves existing Lobby/platform-host flows while making new saves card-derived.

## Platform Host API

Keep existing exported APIs working:

- `listPlatformSaves()`
- `createPlatformSave()`
- `selectPlatformSave()`
- `deletePlatformSave()`
- `getPlatformActiveSaveId()`

Add card-facing APIs for future UI and later children:

- `listPlatformGameCards()`
- `getPlatformGameCard(cardId)`
- `createPlatformSaveFromGameCard(cardId, input?)`
- `getPlatformActiveGameCard()` or equivalent resolver.

`initializePlatformHost()` should ensure the built-in blank card exists before it auto-selects or creates saves.

## Compatibility

Because the prototype storage policy allows database-name resets, this child does not need to migrate old IndexedDB data. However, runtime code should still tolerate a save record without `gameCardId`:

- `PlayView` and platform-host can fall back to `official-default` until remote bridge child changes frontend loading.
- listing/deleting/selecting legacy-shaped saves should not throw.

## Checkpoint Semantics

No new checkpoint table or top-level save concept is needed. Checkpoints remain inside a save instance:

`Game Card -> Save Instance -> Checkpoints`

The initial checkpoint for a card-derived save must include the copied workspace template, so restoring to initial state returns to the card's starting workspace copy.

## Docs/Specs

Update active docs and specs to record:

- game card as reusable workspace template;
- save instance as card-derived playable copy;
- checkpoint as save-local rollback point;
- import/export deferred to sibling child.

Relevant files likely include:

- `docs/active/airp-workflow-platform-direction.md`
- `docs/active/agent-framework-runtime-workspace-direction.md`
- `docs/active/current-state-handoff.md`
- `.trellis/spec/platform-web/frontend/state-management.md`
- `.trellis/spec/contracts/backend/directory-structure.md`
