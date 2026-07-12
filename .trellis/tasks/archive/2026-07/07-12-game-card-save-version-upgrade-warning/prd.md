# 游戏卡升级存档版本提示与工坊资源版本统一

## Goal

让游戏卡/资源升级时的版本判断可信：旧存档继续使用新版卡前必须提示；创意工坊展示版本必须与实际可下载包内版本一致，避免玩家看到的版本和下载安装到本地后的版本分叉。

UI 文案只面向玩家，使用“版本”“本次发布”“旧版存档”等词，不暴露 `manifest`、`resourceVersion`、metadata 等内部机制。

## Background / Confirmed Facts

- 存档记录已有 `gameCardVersion?: string` 字段（`apps/platform-web/src/storage/db.ts:13-20`）。
- 新建存档时会写入当时的 `card.manifest.version`（`apps/platform-web/src/storage/saves.ts:70-122`）。
- 同 ID 游戏卡覆盖安装不会删除存档，但旧存档会运行在当前安装的卡内容之上。
- 当前创意工坊 `resourceVersion` 可以通过上传/编辑表单独立于包内版本修改；这会导致工坊显示版本和下载包实际版本不一致。
- Game Card 包内版本来自 `game-card.json -> manifest.version`。
- Agent / Skill / Tool 包内版本来自 `resource-package.json -> version`。

## Requirements

### R1 — 旧版本存档启动前提示

当玩家在 Play 启动器点击继续某个存档时，如果该存档记录的 `gameCardVersion` 与当前卡 `manifest.version` 不一致，或存档缺失 `gameCardVersion`，必须先提示玩家确认。玩家取消时不得启动前端；玩家确认后才能继续启动。

### R2 — 确认后记录当前卡版本

玩家确认使用当前卡版本继续旧存档后，平台应把该存档的 `gameCardVersion` 更新为当前卡 `manifest.version`，避免同一版本重复提示。该更新不应改变存档 `updatedAt`。

### R3 — 启动器显示旧版提示

Play 启动器存档列表应对版本不一致/未知的存档显示轻量提示标记，例如“旧版存档”。

### R4 — 工坊同 ID 卡覆盖安装告警

从创意工坊安装游戏卡时，如果本地已有同 ID 卡并将覆盖安装，应提示已有存档会保留，且旧版存档首次继续时会询问是否使用新版。

覆盖判断与存档影响计算必须基于实际下载包内的游戏卡 id/version，而不是只依赖创意工坊列表 metadata。

### R5 — 上传/替换时版本写入包

上传或替换资源时，表单中的“版本”必须写入本次生成的资源包：

- Game Card：写入 `game-card.json -> manifest.version`。
- Agent / Skill / Tool：写入 `resource-package.json -> version`。

Game Card 上传成功后，本地卡的 `manifest.version` 应同步为本次发布版本，避免作者本地卡与刚发布的包继续分叉。

### R6 — 创意工坊版本只索引包版本

服务端保存/返回的 `resourceVersion` 必须来自包内版本：

- 初次上传：使用上传包内版本。
- 仅编辑发布资料且不替换包：保留已有版本。
- 替换包：使用新包内版本。
- multipart form 的 `version` 字段不得覆盖包内版本。

### R7 — 发布资料编辑不能单独改版本

编辑已发布资源但不替换资源包时，版本只能只读展示；不允许单独改版本。选择替换资源后，才允许编辑“版本”并用它生成新包。

## Constraints

- 不新增 Dexie 表，不改 Dexie schema。
- 版本比较只做 trim 后字符串不等判断，不做 semver 大小判断。
- 不做多版本卡本地并存。
- 不做自动 workspace 文件合并或存档迁移 manifest。
- 不改变删卡级联删除存档的现有语义。
- 不把内部版本机制暴露到玩家 UI。

## Acceptance Criteria

- [ ] AC1: 创建于卡版本 A 的存档，在当前卡版本变为 B 后，Play 启动器显示旧版提示。
- [ ] AC2: 点击继续版本不一致/未知的存档会弹确认；取消后不启动游戏前端。
- [ ] AC3: 确认继续后，存档 `gameCardVersion` 更新为当前卡版本，`updatedAt` 不变，并正常启动游戏前端。
- [ ] AC4: 确认后再次回到启动器，同一当前卡版本下不再对该存档重复提示。
- [ ] AC5: 工坊覆盖安装同 ID 游戏卡时，覆盖确认使用下载包真实 id/version 计算影响并提示旧版存档。
- [ ] AC6: 上传 Game Card 时填写版本后，工坊显示版本、下载包版本、本地卡属性版本一致。
- [ ] AC7: 上传 Agent / Skill / Tool 时填写版本后，工坊显示版本与 `resource-package.json` 版本一致。
- [ ] AC8: 仅编辑发布资料不替换包时，不能单独改版本；版本保持不变。
- [ ] AC9: 替换发布资源时，新版本来自新导出的包。
- [ ] AC10: 服务端即使收到独立 form version，也以包内版本/已有版本为准。
- [ ] AC11: `npm run build:web` 通过，相关 platform-server market 测试通过。
