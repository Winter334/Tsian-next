# Design — 存档版本提示与创意工坊资源版本统一

## Overview

本任务包含两个相关层面：

1. 存档启动时使用 `LocalSaveRecord.gameCardVersion` 与当前卡 `manifest.version` 做显式确认，避免旧存档静默跑新版卡。
2. 创意工坊 `resourceVersion` 改为“包内版本索引”，上传/替换时把玩家输入的“版本”写进包，服务端只按包内版本落库。

玩家 UI 只显示“版本”等简短概念，不暴露内部字段或包结构。

## Version Authority

- Game Card 权威版本：`game-card.json -> manifest.version`。
- Agent / Skill / Tool 权威版本：`resource-package.json -> version`。
- MarketPackage.resourceVersion：服务端从包内版本派生的索引/展示字段，不是独立可编辑 metadata。

## Frontend Boundaries

### Game Card package export

Files:

- `apps/platform-web/src/storage/game-card-packages.ts`
- `apps/platform-web/src/platform-host/game-cards.ts`

Add export options:

```ts
interface GameCardPackageExportOptions {
  version?: string
}
```

`exportGameCardPackage(cardId, options)` uses `options.version?.trim()` to override the manifest version in the exported zip only. It does not write local DB itself.

Add a read-only inspect helper for install:

```ts
inspectGameCardPackage(blob): Promise<{ manifest: GameCardManifest }>
```

This lets Market install prompts use the downloaded package's real id/version.

### Resource package export

File: `apps/platform-web/src/platform-host/resource-packages.ts`

Add export options:

```ts
interface ResourcePackageExportOptions {
  version?: string
}
```

`exportAgentPackage` / `exportSkillPackage` / `exportToolPackage` write that version into `resource-package.json`. Existing callers without options keep `0.1.0` default.

### Market upload/update UI

Files:

- `apps/platform-web/src/views/AppMarketView.vue`
- `apps/platform-web/src/components/market/MarketPackageDetail.vue`

Upload:

- Dialog label is `版本`, not `版本（可选）`.
- Version is required; error copy is `版本不能为空。`.
- The version is passed to exporter, not to market metadata.
- For Game Card upload, after successful upload, update local card metadata version to the uploaded version if it differs.

Edit existing package:

- Without replacement: version is read-only display.
- With replacement: version input is editable and required; it is passed to exporter for the replacement package.
- Update request no longer sends version as independent metadata.

### Game Card install prompt

`installGameCardPackage(pkg)` downloads the blob before showing overwrite prompt, inspects package manifest, and uses real `manifest.id/version/name` for:

- local existing-card lookup;
- affected save count;
- player-facing warning.

The confirmed import reuses the already downloaded blob.

## Server Boundary

File: `apps/platform-server/internal/market/handler.go`

`formPublishMetadata` handles title/summary/author only. Version persistence is determined by package source:

- `HandleUpload`: `ResourceVersion = manifest.ResourceVersion`.
- `buildPackageUpdate` without replacement: `ResourceVersion = existing.ResourceVersion`.
- `buildPackageUpdate` with replacement: `ResourceVersion = manifest.ResourceVersion`.

Multipart `version` may still be present from old clients, but it is ignored for persistence.

## Compatibility

- Existing market rows remain as-is until edited/replaced; new server behavior prevents future drift.
- Historical rows with drift are handled at install time for Game Cards because the frontend inspects downloaded package version.
- Existing local Game Cards keep `manifest.version`; uploads can synchronize it after successful publish.
- No IndexedDB schema changes.

## UI Copy

Allowed player-facing terms:

- 版本
- 本次发布
- 替换资源
- 旧版存档
- 使用新版

Avoid:

- manifest
- resourceVersion
- metadata
- 包内真实版本
- schema/path jargon in market dialogs

## Tests / Validation

Frontend:

- `npm run build:web`
- Browser smoke for upload/install if feasible.

Server:

- Market tests for upload/update version authority.
- At minimum run the platform-server market-related Go tests.

## Rollback

The change does not migrate local DB. Reverting frontend/server code restores previous metadata-version behavior. Rows created during the new behavior have consistent `resourceVersion` and package versions and remain valid under previous code.
