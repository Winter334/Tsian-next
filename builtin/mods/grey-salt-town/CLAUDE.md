# grey-salt-town — 模块 CLAUDE.md

[根目录](../../../CLAUDE.md) > [builtin](../../) > [mods](../) > **grey-salt-town**

---

## 1. 模块职责

内置测试模组「灰盐镇·雨夜验尸」，作为开发期验证：

- 模组静态层（`ModStaticContent`）
- 预设事件钩子（`eventCatalog`）
- 实体档案种子（`archiveCatalog`）
- 初始存档载荷（`createGreySaltTownInitialSavePayload`）
- 记忆系统在已有事件 + 档案下的检索行为

不视为长期官方模组，仅原型期内置。

---

## 2. 入口与启动

| 入口 | 路径 |
|------|------|
| 模组入口 | `src/index.ts` |
| 注册位置 | `builtin/mods/index.ts`（被 `apps/platform-web/src/platform-host` 与 `storage/saves` 直接 import） |

导出：

- `greySaltTownMod: ModStaticContent`
- `createGreySaltTownInitialSavePayload(now: number): ModInitialSavePayload`

---

## 3. 对外接口

### `greySaltTownMod`

- `manifest`：`id="grey-salt-town"`, `version="0.1.0"`, 作者 `"Tsian Prototype"`
- `frontendConfig.frontendId="official-default"`
- `entityTypeDefinitions`：character / location / organization / monster / equipment / consumable / material / clue
- `archiveCatalog`：≈25 条档案（叶临、许砚、韩照、罗缇、井下鳞妖、灰盐镇驿馆、盐仓、旧井、青铜验妖铃、黑鳞、缺扣袖衣、铜扣、湿盐、油纸袋、掺沙假盐、…）
- `eventCatalog`：2 条预设事件钩子
  - `grey-salt-town-salt-warehouse-token`：盐仓令牌线索浮现
  - `grey-salt-town-well-scale-reaction`：旧井黑鳞再度反应
- `globalsDefaults`：章节 / 当前地点 / 天气 / 当前目标 / 同行者

### `createGreySaltTownInitialSavePayload(now)`

返回包含 7 条历史/进行中事件 + 25 条档案 + 初始 snapshot（含 6 条预制对话消息）的初始载荷。

**H10 临时修复**：`now` 参数已被忽略（参数改为 `_now`），所有时间锚定在虚构纪元 `NARRATIVE_ANCHOR_UTC_MS`（`Date.UTC(1, 0, 15, 23, 0)`，即故事"当前时刻" `0001-01-15 23:00`，注意 JS `Date.UTC` 对 0-99 年份自动加 1900 的历史包袱，实际显示 `1901-01-15 23:00`，主人决策接受此偏差作为虚构纪元）；待契约层支持模组声明叙事锚点后正式迁移。

---

## 4. 关键依赖与配置

- `@tsian/contracts` — 类型来源
- 无第三方运行时依赖

---

## 5. 数据模型

完全遵循 `@tsian/contracts` 中的 `ArchiveRecord`、`EventRecord`、`CatalogEventRecord`、`ModStaticContent`、`ModInitialSavePayload`。

---

## 6. 测试与质量

通过随 `apps/platform-web` 一起构建（`npm run build:web`）做类型与基本完整性校验。

---

## 7. 常见问题 (FAQ)

**Q：可以删掉吗？**
A：当前不行——`apps/platform-web/src/storage/saves.ts` 以及 `platform-host` 直接 import；删除前需要先把模组装载链改成空模组兜底。

**Q：能扩展更多预设事件吗？**
A：可以，遵循 `CatalogEventRecord` 结构；注意原型期不要把它当长期官方模组使用。

---

## 8. 相关文件清单

- `src/index.ts`
- `../index.ts`（同级注册器，导出 `defaultModId / listBuiltinMods / getBuiltinMod / getDefaultBuiltinMod / createBuiltinModInitialSavePayload`）

---

## 9. 变更记录 (Changelog)

| 时间 | 变更 |
|------|------|
| 2026-05-05 17:52:53 | 初始化架构师首次生成模块文档 |

---

_文档生成时间：2026-05-05 17:52:53_
