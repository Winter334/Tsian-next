# 自定义 Tools 创意工坊分发 — Design

## Status

Planning artifact for `.trellis/tasks/07-06-custom-tools-workshop-distribution/`.

This task is a cross-layer distribution change. It does not change Tool runtime discovery/execution semantics; it extends the existing Creative Workshop resource-package path so Tool directories can be uploaded, downloaded, installed, and included in desktop-assistant Agent packages.

## Repository Evidence

- `MarketResourceType` is currently `"game_card" | "agent" | "skill"` (`packages/contracts/src/market.ts`).
- Server `ResourceType` mirrors the same three resource types in `apps/platform-server/internal/market/market.go`.
- Non-card resources use `tsian.resource.package.v1` with a root `resource-package.json` manifest (`apps/platform-web/src/platform-host/resource-packages.ts`).
- Existing Skill package sources/targets cover card-shared, agent-local, and assistant-local directories. Tool should mirror those shapes.
- Tool registry paths already exist: shared `tools/<id>/tool.json`, card Agent-local `agents/<agentId>/tools/<id>/tool.json`, and user-local `.tsian/local/<agentId>/tools/<id>/tool.json`.
- Full game-card package export already includes all card content files; this task only adds focused Tool packages and assistant-package inclusion.
- Desktop assistant Agent export currently carries identity files plus `skills/`, but not `tools/`.

## Architecture Overview

```text
Creative Workshop resource types
  game_card  -> existing .tsian-card.zip package
  agent      -> existing resource-package.json package
  skill      -> existing resource-package.json package
  tool       -> new resource-package.json package

Tool package file layout
  resource-package.json
  tool.json
  run.js
  helpers/...        # any text file under the Tool directory

Source directories
  card shared:       tools/<toolId>/...
  card agent-local:  agents/<agentId>/tools/<toolId>/...
  assistant-local:   .tsian/local/assistant/tools/<toolId>/...

Install targets
  card shared:       tools/<resourceId>/...
  card agent-local:  agents/<agentId>/tools/<resourceId>/...
  assistant-local:   .tsian/local/assistant/tools/<resourceId>/...
```

A Tool package mirrors a Skill package: it strips the containing directory on export, stores package-internal paths relative to that directory, and writes those relative files under the selected target directory on install.

## Contracts Layer

### `packages/contracts/src/market.ts`

Extend:

```ts
export type MarketResourceType = "game_card" | "agent" | "skill" | "tool"
```

`MarketPackageCounts = Record<MarketResourceType, number>` will then require the server to include a `tool` count. Existing frontend visual maps become exhaustiveness checks: `resourceTypeVisuals: Record<MarketResourceType, ResourceTypeVisual>` must gain a Tool entry.

No runtime validation belongs in contracts; platform-web and platform-server continue validating package files at their boundaries.

## Platform-Web Resource Packages

### Type additions

In `apps/platform-web/src/platform-host/resource-packages.ts`:

```ts
export type ToolPackageSource =
  | { kind: "card-shared"; cardId: string; toolId: string; toolPath?: string }
  | { kind: "agent-local"; cardId: string; agentId: string; toolId: string; toolPath?: string }
  | { kind: "assistant-local"; toolId: string; toolPath?: string }

export type ToolInstallTarget =
  | { kind: "card-shared"; cardId: string }
  | { kind: "agent-local"; cardId: string; agentId: string }
  | { kind: "assistant-local" }
```

Extend `ResourcePackageInspection.resourceType` to include `"tool"`.

### Export flow

Add `exportToolPackage(source)`:

1. Resolve source files:
   - assistant-local -> `assistantToolPackageFiles(source)`
   - card shared / card agent-local -> `cardToolPackageFiles(source)`
2. Require root `tool.json` in the stripped package files.
3. Parse `tool.json` enough to derive metadata:
   - `resourceId`: source `toolId` (path-derived, stable)
   - `name`: `tool.json.title` → `tool.json.name` → `toolId`
   - `summary`: `tool.json.description` → fallback string
4. Call `buildResourcePackage({ resourceType: "tool", ... }, sourceFiles)`.

This deliberately does not call runtime `parseToolManifest` directly because package export should not inherit registry diagnostic behavior or skip an otherwise selectable directory due to transient runtime diagnostics. The upload list will normally be registry-backed, so invalid Tools are unlikely to appear; the package validator still requires `tool.json`.

### Install flow

Add `installToolPackage(blob, target)`:

1. `parseResourcePackage(blob, "tool")`
2. Target directory:
   - card shared: `tools/${resourceId}`
   - agent-local: `agents/${agentId}/tools/${resourceId}`
   - assistant-local: `.tsian/local/assistant/tools/${resourceId}`
3. Write via existing replace helpers:
   - card targets -> `replaceCardContentDirectory(cardId, directory, files)`
   - assistant target -> new `replaceAssistantToolDirectory(resourceId, files)` using `replaceLocalAssistantFiles([directory], ...)`

Installing a Tool package does not edit `agent.json.tools.enabled/disabled`. This matches Skill install behavior: install writes the resource directory; enable/disable state remains a separate Studio / Assistant config concern.

### Required-file and manifest validation

Update `validateResourceManifest` to accept `"tool"` and `validateRequiredFiles` to require root `tool.json` for Tool packages.

`parseResourcePackage` already enforces:

- root `resource-package.json` exists;
- listed files exist;
- zip has no unlisted files;
- package paths are safe relative paths;
- content is UTF-8 text.

Those constraints are sufficient for Tool package v1.

### Desktop assistant Agent package

Update assistant Agent package helpers:

- `assistantDefinitionPackageFiles()` includes `relativePath.startsWith("tools/")` in addition to `skills/`.
- `replaceAssistantDefinition()` replacement roots include `${LOCAL_ASSISTANT_DIR}/tools`.
- Existing roots for sessions / traces / notes remain excluded so local runtime data survives assistant replacement.

## Platform-Web Market UI

### Resource type visuals

Add a Tool visual in `components/market/resource-type-visual.ts`, likely using a Lucide tool-shaped icon (`Wrench`, `Hammer`, or similar) and the same warm-amber CRT palette family.

### Shared UI types

In `components/market/types.ts`:

- add `ToolUploadOption` mirroring `SkillUploadOption`;
- extend `MarketUploadSelectionPayload` with `{ resourceType: "tool"; source: ToolPackageSource }`;
- extend `MarketInstallTargetOption` with a Tool branch carrying `ToolInstallTarget`.

### Upload panel

`MarketUploadPanel.vue` gains a Tool branch parallel to Skill:

- prop `toolOptions: ToolUploadOption[]`;
- empty state: “当前加载卡没有可上传的 Tool。”;
- card grid using the Tool visual;
- `selectTool(key)` emits `{ resourceType: "tool", source }`.

### `AppMarketView.vue`

Update imports:

- import `buildToolRegistry` and `ToolRegistryEntry`;
- import `exportToolPackage` / `installToolPackage`.

Add `resourceTypeOption("tool", resourceTypeVisuals.tool, "原生函数工具")` (final Chinese wording can be adjusted during implementation).

Add computed `toolUploadOptions`:

- for each loaded card file set, use `buildToolRegistry(files).tools`;
- shared registry entries become `{ kind: "card-shared", cardId, toolId: tool.id, toolPath: tool.path }`;
- agent-local registry entries with `agentId` become `{ kind: "agent-local", cardId, agentId, toolId: tool.id, toolPath: tool.path }`;
- for assistant files, use `buildToolRegistry(assistantFiles).tools` and include entries whose path starts with `.tsian/local/assistant/tools/` or whose `agentId === "assistant"` and directory is under the assistant local tools root.

Update logic branches:

- `uploadMetadataDefaults` handles Tool using `toolUploadOptions`.
- `sameToolSource` mirrors `sameSkillSource`.
- `exportMarketSelection` calls `exportToolPackage`.
- `replacementSelectionLabel` handles Tool.
- `emptyMessage` handles Tool.
- `buildInstallOptions` adds a Tool branch instead of treating all non-Agent resources as Skill.
- `handleInstallTargetSelected` dispatches Agent / Skill / Tool explicitly.

Tool install options mirror Skill options:

- active non-builtin card shared target: exists if `tools/${resourceId}/tool.json` exists.
- each Agent on active non-builtin card: exists if `agents/${agent.id}/tools/${resourceId}/tool.json` exists.
- assistant target: exists if `.tsian/local/assistant/tools/${resourceId}/tool.json` exists.

Update user-facing confirm copy to say Tool and mention target directory conceptually.

## Platform-Server Market Support

### Resource type plumbing

In `apps/platform-server/internal/market`:

- add `ResourceTool ResourceType = "tool"`;
- include `ResourceTool: 0` in default `CountsByResourceType` maps;
- include `tool` in count JSON responses;
- accept `ResourceTool` in `parseResourceType`;
- route `ResourceTool` through `validateResourcePackageZip` in `validateUploadZip`;
- require `tool.json` in `validateResourcePackageZip` for `ResourceTool`;
- return `${id}.tsian-tool.zip` from `downloadFileName`.

No database schema change is needed: `market_packages.resource_type` is plain text with no CHECK constraint.

### Tests

Extend existing market tests rather than creating a new server test suite:

- `TestMarketResourcePackages` uploads a Tool package, lists `resourceType=tool`, validates response metadata, tags, and download filename.
- Count expectations include `tool` (0 or 1 depending on the test).
- `TestMarketResourcePackageValidation` adds a Tool missing `tool.json` case, or parameterizes missing required file across Agent / Skill / Tool.

## Documentation

Update `docs/reference/tool-vs-skill.md`:

- Keep `.tsian/local/<agent>/tools/<id>` as local / non-checkpoint / non-card-package by default.
- Clarify that local Tools can still be explicitly exported as focused Tool resource packages.
- Add Tool to the Studio / 创意工坊 distribution notes.
- Explain that Tool packages carry Tool directory content only, not `agent.json.tools.enabled/disabled` state.

## Compatibility

- Existing Game Card, Agent, and Skill packages remain valid.
- Existing workshop package rows need no migration; old rows keep their resource types.
- Existing clients that do not know `tool` will not render the new type correctly, but this project deploys platform-web and platform-server together.
- Tool install does not automatically enable a Tool when an Agent is in whitelist mode, matching Skill install not automatically enabling Skills.
- Assistant Agent package replacement becomes slightly broader because it now replaces `tools/` as well as `skills/`; confirmation copy must surface this.

## Risks / Gotchas

- Exhaustive TypeScript records over `MarketResourceType` will fail build until Tool visual and UI branches are complete.
- `buildInstallOptions` currently treats every non-Agent package as Skill; this must become an explicit `agent` / `skill` / `tool` branch.
- Server count responses must include `tool`; otherwise UI badges may show undefined even though the TypeScript contract says all keys exist.
- Assistant replacement must not delete notes, sessions, traces, or attachments. Only add `tools/` to the existing replacement root set.
- The package root strips the Tool directory; requiring root `tool.json` is essential to avoid accidentally uploading a parent directory or helper-only zip.

## Validation Strategy

- Contracts build: `npm run build:contracts`.
- Platform web build: `npm run build:web`.
- Server tests: `go -C ./apps/platform-server test ./...`.
- Manual smoke if runtime environment is available:
  1. create / identify a card shared Tool;
  2. upload it as Tool;
  3. install it to a card shared target;
  4. verify `tools/<id>/tool.json` exists and Studio diagnostics still work;
  5. repeat for assistant-local target if practical.

## Rollback Shape

The change is additive except for assistant Agent package replacement breadth:

- Revert `MarketResourceType` / server `ResourceTool` additions.
- Remove Tool UI branches and package helper exports.
- Remove `tools/` from assistant Agent package include / replace roots.
- Existing uploaded `tool` rows on a test server would become unreadable by older clients; production rollback should delete or hide such rows if any were created during rollout.
