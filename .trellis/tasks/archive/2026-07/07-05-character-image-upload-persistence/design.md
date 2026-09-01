# 角色形象上传与持久化 — Design

## Scope

本任务把角色卡左侧固定立绘栏从 MVP 首字占位升级为：

1. 有玩家上传头像时显示 workspace 中持久化的图片。
2. 无上传头像或读取失败时显示内置默认男/女头像。
3. protagonist 可通过角色卡上传/更换图片，NPC 默认只读。

## Architecture Decisions

### D1. Uploaded portrait is a save-runtime media asset

玩家上传头像属于当前存档的角色资产，进入 `save-runtime` workspace，而不是 play frontend 私有 IndexedDB。理由：

- 随存档、检查点、导出/导入生命周期统一处理。
- 未来 AI 生图、资源管理器导入、玩家上传可以汇入同一 `portrait.path`。
- 不引入第二套前端私有状态权威。

### D2. Default portraits are bundled frontend assets

默认男/女头像是前端主题素材，不属于某个存档，不进入 workspace。它们会复制到：

```text
apps/play-frontend-dev/src/assets/avatars/default-female.png
apps/play-frontend-dev/src/assets/avatars/default-male.png
```

Vite 通过 `vite/client` 支持 PNG import，构建时输出 hashed asset URL。

### D3. Portrait media is not default AIRP semantic input

`portrait.path` 是 UI/media metadata。默认 runtime / character injection 不读取、不展开、不注入图片内容。非多模态 AIRP 使用 `appearance` / `brief` / `status` 等文本字段理解角色视觉与状态。

这避免把图片 blob 变成每轮 prompt 噪音，也避免要求所有 LLM 支持多模态。

## Data Contracts

### Entity metadata

Character entity 可选字段：

```json
"portrait": {
  "path": "save/assets/portraits/characters/萧玄.webp",
  "mimeType": "image/webp",
  "updatedAt": "2026-07-06T00:00:00.000Z",
  "updatedBy": "player"
}
```

字段说明：

- `path` 必须是非空字符串，指向 save-runtime workspace 中的 media asset。
- `mimeType` 当前上传流程写入 `image/webp`。
- `updatedAt` 使用 ISO timestamp。
- `updatedBy` 当前上传流程写入 `player`。

### Binary file path

上传图片固定写入：

```text
save/assets/portraits/characters/<localId>.webp
```

`localId` 从 `entityRef` 的冒号后半段取得。前端使用该路径写入 `Blob`，entity JSON 只保存引用。固定 `.webp` 路径让重复上传自然覆盖，不需要新增 delete API。

### Gender fallback

默认头像选择输入：

```text
entity.identity?.gender ?? entity.gender
```

规则：

1. 值包含 `女` 或匹配英文 female/woman/girl/f → 女图。
2. 值包含 `男` 或匹配英文 male/man/boy/m → 男图。
3. 缺失、未知、不明确、其它值 → 男图。

英文先判 female 再判 male，避免 `female` 被 `male` 子串误判。

## Data Flow

### Upload flow

```text
file input
  → validate MIME / size
  → decode image
  → center crop to 3:4.15
  → canvas export image/webp Blob
  → tsian.workspace.write(save/assets/portraits/characters/<localId>.webp, blob, "save-runtime")
  → tsian.workspace.read(save/entities/character/<localId>.json, "save-runtime")
  → patch entity.portrait metadata
  → tsian.workspace.write(entity path, JSON.stringify(entity, null, 2) + "\n", "save-runtime")
  → CharacterSlot reloads entity
  → CharacterPortrait reloads image Blob and object URL
```

If image write succeeds but JSON metadata write fails, the UI reports failure. Because the image path is deterministic, a later successful upload overwrites the same path; orphan risk is acceptable for this slice.

### Display flow

```text
CharacterSlot loads entity
  → parseCharacter extracts portrait + gender
  → CharacterCard computes default avatar URL by gender
  → CharacterPortrait receives portraitPath + fallbackSrc
  → if portraitPath exists: workspace.read(binary file)
      → if binary exists: URL.createObjectURL(binary) and render <img>
      → if missing/error/no binary: fallbackSrc
  → if no portraitPath: fallbackSrc
```

Object URLs are revoked before replacement and on unmount.

## Bridge Boundary

The public play bridge currently rejects non-string `workspace.write` content. The storage/runtime layer already supports `Blob` through `WorkspaceOperationRequest.content?: string | Blob` and Dexie `workspaceFiles.data?: Blob`.

Implementation updates only the public boundary:

- `packages/contracts/src/bridge.ts`: `WorkspaceWriteRequest.content: string | Blob`.
- `packages/play-bridge/src/tsian-api.ts`: `write(path, content: string | Blob, scope?)`.
- `apps/platform-web/src/bridge/remote-iframe-bridge.ts`: allow string or Blob in `normalizeWorkspaceWriteRequest`.
- `apps/platform-web/src/platform-host/index.ts`: pass content through unchanged.

No Dexie schema change is required.

## UI Design

`CharacterPortrait.vue` keeps the existing 3:4.15 frame, inner line, bottom gradient, and dark ritual tone. Changes:

- Primary content becomes `<img>` rather than glyph.
- Upload / change button appears only for protagonist, as a small hover/focus overlay.
- During upload, the control is disabled and shows progress text.
- Feedback uses compact overlay/status text inside or below the portrait frame.
- NPCs can display existing portrait or default avatar, but do not show upload controls.

## Compatibility

- Existing saves without `portrait` render default avatars.
- Existing top-level `gender` is parsed for default avatar compatibility; `identity.gender` remains preferred.
- Existing string workspace writes continue to compile and run.
- Existing `workspace.read` consumers still receive text `content`; binary-capable consumers may also use `binary`.

## Risks And Mitigations

- **Prompt/AIRP noise**: mitigated by treating `portrait` as UI/media metadata and not injecting binary content by default.
- **Large upload memory cost**: mitigated by 5MB source limit and canvas-resized WebP output.
- **Object URL leaks**: mitigated by revoke on replacement/unmount.
- **Entity JSON write failure after binary write**: deterministic path allows overwrite; UI reports failure.
- **Packaged frontend builder image imports**: this task targets `play-frontend-dev` Vite build. If platform in-browser frontend builder later needs the same assets, image asset support should be handled in a separate frontend-builder task.
