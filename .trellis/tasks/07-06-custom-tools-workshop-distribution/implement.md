# 自定义 Tools 创意工坊分发 — Implementation Plan

## Preconditions

- Task status remains `planning` until PRD/design/implement artifacts are reviewed.
- This task changes contracts, platform-web, platform-server, and docs.
- No Dexie or SQLite schema migration is expected.

## Ordered Checklist

### 1. Contracts

- [ ] Extend `MarketResourceType` in `packages/contracts/src/market.ts` with `"tool"`.
- [ ] Run / defer to validation step `npm run build:contracts` after consuming changes are in place.

### 2. Platform-server market support

- [ ] Add `ResourceTool ResourceType = "tool"` in `apps/platform-server/internal/market/market.go`.
- [ ] Include `ResourceTool` in default counts and count JSON responses.
- [ ] Accept `ResourceTool` in `parseResourceType`.
- [ ] Route `ResourceTool` through `validateResourcePackageZip` in `validateUploadZip`.
- [ ] Require `tool.json` in `validateResourcePackageZip` for Tool packages.
- [ ] Add `.tsian-tool.zip` download filename.
- [ ] Update market tests:
  - upload a valid Tool package;
  - list / filter `resourceType=tool`;
  - verify counts include `tool`;
  - verify download filename;
  - verify Tool package missing `tool.json` fails.

### 3. Platform-web package helpers

- [ ] Add `ToolPackageSource` and `ToolInstallTarget` in `apps/platform-web/src/platform-host/resource-packages.ts`.
- [ ] Extend `ResourcePackageManifest.resourceType` / inspection type to include Tool.
- [ ] Add `exportToolPackage(source)`:
  - card shared -> `tools/<toolId>`;
  - card agent-local -> `agents/<agentId>/tools/<toolId>`;
  - assistant-local -> `.tsian/local/assistant/tools/<toolId>`;
  - require root `tool.json`;
  - derive metadata from `tool.json` (`title` / `name` / `description`) with safe fallbacks.
- [ ] Add `installToolPackage(blob, target)` with card shared, agent-local, and assistant-local target directories.
- [ ] Add `replaceAssistantToolDirectory` helper.
- [ ] Update `validateResourceManifest` and `validateRequiredFiles` to accept `tool` and require `tool.json`.
- [ ] Update exports in `apps/platform-web/src/platform-host/index.ts` if needed.

### 4. Desktop assistant Agent package symmetry

- [ ] Include `relativePath.startsWith("tools/")` in `assistantDefinitionPackageFiles()`.
- [ ] Include `${LOCAL_ASSISTANT_DIR}/tools` in `replaceAssistantDefinition()` replacement roots.
- [ ] Update UI copy for assistant Agent replacement to mention both skills and tools.

### 5. Market UI and type branches

- [ ] Add Tool visual in `components/market/resource-type-visual.ts`.
- [ ] Extend `components/market/types.ts` with Tool upload and install option types.
- [ ] Extend `MarketUploadPanel.vue` with `toolOptions` prop and Tool selection branch.
- [ ] Update `AppMarketView.vue`:
  - add Tool resource type option;
  - compute `toolUploadOptions` using `buildToolRegistry`;
  - add `sameToolSource`;
  - handle Tool in upload defaults, export selection, replacement labels, empty messages;
  - build Tool install targets for current non-builtin card and assistant;
  - dispatch install to `installToolPackage`.
- [ ] Audit non-Agent branches that currently imply Skill and split into explicit Skill / Tool handling.
- [ ] Update upload / replacement dialog props for Tool options.

### 6. Documentation

- [ ] Update `docs/reference/tool-vs-skill.md`:
  - Tool independent workshop package;
  - `.tsian/local/**` local-by-default but explicitly exportable;
  - Tool package does not carry enable/disable state.

### 7. Validation

- [ ] Run `npm run build:contracts`.
- [ ] Run `npm run build:web`.
- [ ] Run `go -C ./apps/platform-server test ./...`.
- [ ] If a browser smoke is practical, manually verify upload/install for at least one Tool package and assistant-local install.

## Risky Files / Review Gates

- `packages/contracts/src/market.ts`: contract exhaustiveness; all consumers must be updated in the same change.
- `apps/platform-web/src/views/AppMarketView.vue`: currently has several non-Agent = Skill assumptions; review every `resourceType === "agent" ? ... : ...` branch.
- `apps/platform-web/src/platform-host/resource-packages.ts`: package path stripping must be exact; root `tool.json` is required.
- `apps/platform-server/internal/market/handler.go`: server validation should match frontend package semantics.
- `apps/platform-web/src/platform-host/resource-packages.ts` assistant replacement roots: must add `tools/` without broadening to sessions/traces/notes.

## Rollback Points

- After contracts/server only: revert `tool` contract and ResourceTool if platform-web not yet updated.
- After platform-web helper changes: remove `exportToolPackage` / `installToolPackage` and UI references.
- After assistant Agent package change: remove `tools/` from assistant export/replace roots if replacement breadth proves risky.

## Context Manifests

- `implement.jsonl` and `check.jsonl` should include the relevant spec / research docs before `task.py start` because ZCode uses sub-agent dispatch workflow guidance.
