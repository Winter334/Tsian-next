# Game Card Library And Save Instance Model

## Goal

Implement the first foundation slice for local game cards and save instances.

A game card is a reusable workspace template. A save instance is a playable copy created from a game card. This child establishes that storage/contract model before remote frontend bridge or UI work.

## Parent

- `.trellis/tasks/06-14-remote-game-frontend-foundation`

## Requirements

- Add typed `GameCardManifest` and remote frontend binding contracts.
- Add minimal local game card storage for manifest metadata and workspace template files.
- Extend save records with optional `gameCardId` and `gameCardVersion`.
- Add helpers to list/get/create local game cards.
- Add helper to create a save instance from a game card by copying its workspace template files.
- Seed a built-in blank game card that preserves current contentless Agent Runtime behavior.
- Newly created card-derived saves should get initial snapshot/history/workspace/checkpoint atomically.
- Existing contentless saves should remain usable through a compatibility path.
- Do not implement import/export package format in this child.
- Do not implement remote iframe loading in this child beyond storing the frontend binding.

## Acceptance Criteria

- [x] Contracts expose a game card manifest and remote frontend binding type.
- [x] Platform-web local storage can persist game card records.
- [x] Save records can associate to a game card id/version.
- [x] A built-in blank game card can be resolved without workshop/import/export systems.
- [x] Creating a save from a game card copies workspace template files into an independent save workspace.
- [x] Initial checkpoint for a card-derived save captures the copied workspace.
- [x] Existing create/select/delete save flows keep working.
- [x] Import/export package format remains out of scope and is tracked by sibling child task.
- [x] `npm run build:contracts`, `npm run build:runtime-core`, and `npm run build:web` pass.
- [x] Active docs/specs record the game card / save instance distinction.

## Dependencies

- None. This is the first implementation slice.

## Out Of Scope

- Remote iframe bridge runtime.
- Final lobby/library/workshop UI.
- Account, upload, download, moderation, or online workshop features.
- Game card package import/export format.
