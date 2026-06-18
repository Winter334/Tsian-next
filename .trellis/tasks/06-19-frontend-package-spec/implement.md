# 前端包打包规范与平台内替换 Implementation Plan

## Preconditions

- PRD/design 已用户审阅。
- 加载 `trellis-before-dev` 与 platform-web frontend specs 后再编码。
- 不在本任务 `task.py start` 前动代码。

## Ordered Checklist

### 阶段 0：前置缺陷修复（先修阻塞项，端到端验证基线）

1. **修 SW 数据库名**
   - `apps/platform-web/public/tsian-game-card-frontend-sw.js` 第1行 `tsian-agent-runtime-v5` → `tsian-agent-runtime-v6`。
   - 顶部加注释：`// DB 名须与 src/storage/db.ts 的 TsianLocalDb 构造参数保持一致。`
   - 验证 SW record key `${gameCardId}::${path}` 与 `game-cards.ts` 的 `gameCardFrontendFileId(gameCardId, normalizedPath)` 一致（读源码确认 normalizedPath 规则；若不一致则修正 SW 的 key 拼接）。

2. **扩展 inferMediaType**
   - `apps/platform-web/src/storage/game-card-packages.ts` `inferMediaType` 补充 mp3/ogg/wav/m4a/flac/mp4/webm/mov/avif 映射。

3. **端到端基线验证**
   - 构造一个最简卡包（或用已有含 packaged 前端的卡）→ 打开游玩窗口 → 确认 packaged 前端能加载（SW 修复生效）。
   - 此步通过后再继续，否则后续工作无验证基线。

4. **验证**：`npx vue-tsc -b` + `npm run build`。

**回滚点 R0**：前置修复可独立提交。若后续阶段遇阻，R0 的修复仍有独立价值。

### 阶段 1：Contracts

5. **新增 FrontendPackageManifest 类型**
   - `packages/contracts/src/game-card.ts` 加 `FrontendPackageFileEntry` + `FrontendPackageManifest`（见 design）。
   - 确认 `index.ts` 的 `export * from "./game-card"` 已覆盖（无需额外导出）。
   - `npm run build -w @tsian/contracts`（或对应 contracts 构建命令）生成 dist。

6. **验证**：contracts 构建通过；`npx vue-tsc -b` 能解析新类型。

### 阶段 2：Storage

7. **新增路径校验工具**
   - `game-card-packages.ts` 新增 `assertSafeRelativePath(path)`（无 `..`/绝对/`\0`，不限制前缀）。
   - 新增常量 `FRONTEND_PACKAGE_SCHEMA`、`FRONTEND_PACKAGE_MANIFEST_PATH`。

8. **新增 normalizeFrontendPackageManifest**
   - 校验 schema、entry 非空、bridgeVersion、files 非空。
   - 复用 `requireString` 等现有工具风格。

9. **新增 importGameCardFrontendPackage**
   - 按 design 流程：解包 → 读清单 → 双向校验 → entry 校验 → putLocalGameCard 整体替换（frontendFiles 加 `frontend/` 前缀，manifest.frontend.entry 加前缀）。
   - 错误码：`FRONTEND_PACKAGE_MANIFEST_MISSING`、`FRONTEND_PACKAGE_SCHEMA_UNSUPPORTED`、`FRONTEND_PACKAGE_FILE_MISMATCH`、`FRONTEND_PACKAGE_ENTRY_MISSING`、`FRONTEND_PACKAGE_PATH_INVALID`。

10. **新增 exportGameCardFrontendPackage**
    - 取卡 + frontendFiles → 去 `frontend/` 前缀 → 构造清单 → zipSync → Blob。
    - 错误码：`FRONTEND_EXPORT_CARD_NOT_FOUND`、`FRONTEND_EXPORT_NO_FILES`、`FRONTEND_EXPORT_NOT_PACKAGED`。

11. **确认 putLocalGameCard 空 frontendFiles 语义**
    - 读 `game-cards.ts` putLocalGameCard：`frontendFiles` 未传/undefined = 保留现有；传 `[]` = 事务内删该卡全部 frontendFile。
    - 若空数组确实触发删除，host 层清除连删文件直接传 `[]`；若不触发，host 层需显式 `localDb.gameCardFrontendFiles.where('gameCardId').equals(cardId).delete()` 后再 putLocalGameCard。记录实际选择到本文件。

12. **验证**：`npx vue-tsc -b`。单元层面可手写一个最简 zip（frontend.json + index.html）调用 import 后再 export 验证往返（dev 控制台或临时脚本）。

**回滚点 R2**：storage 层可独立提交（纯函数，无 UI 依赖）。

### 阶段 3：Platform-Host

13. **新增 importPlatformGameCardFrontendPackage**
    - builtin 校验 + 委托 storage。复用 `ensureBuiltinBlankGameCard`。

14. **新增 exportPlatformGameCardFrontendPackage**
    - 委托 storage。

15. **扩展前端清除连删文件**
    - `updatePlatformGameCardFrontend` 传 null/undefined 分支：确认 frontendFiles 语义后，传 `[]` 或显式删表。

16. **验证**：`npx vue-tsc -b`。

### 阶段 4：Views

17. **前端标签页 UI 重构**
    - `GameCardDetailView.vue`：packaged 模式替换为上传/导出/清除按钮 + 只读文件列表 + 只读入口显示。
    - 新增 `frontendPackageInput` ref、`frontendPackageSaving` ref、`handleFrontendPackageSelected`、`handleExportFrontendPackage`、`handleClearFrontend` 函数。
    - 移除原 packagedEntry input + datalist + 文件点击设入口逻辑（保留 `packagedEntry` 变量若仍用于只读展示，否则清理）。
    - Remote URL 分支保持不变。

18. **内置卡保护**
    - 上传/导出/清除按钮 `:disabled` 加 `card.source === 'builtin'` 条件。

19. **验证**：`npx vue-tsc -b` + `npm run build`。

### 阶段 5：端到端验证

20. **构造测试前端包**
    - 手工或临时脚本生成 `.tsian-frontend.zip`：`frontend.json`（schema v1, entry "index.html", files 列表）+ `index.html`（引用 `assets/logo.png`）+ `assets/logo.png`。

21. **上传验证**
    - 我的应用 → 进某本地卡属性 → 前端标签 → 选 packaged → 上传 `.tsian-frontend.zip`。
    - 确认：文件列表显示新文件（含 frontend/ 前缀）、入口正确、游玩窗口能加载 index.html 且 logo.png 显示。

22. **音视频验证**
    - 构造含 `.mp3`/`.mp4` 的前端包上传，`<audio>`/`<video>` 能播放，DevTools Network 确认 Content-Type 正确（`audio/mpeg`/`video/mp4`）。

23. **导出往返验证**
    - 导出当前卡前端为 `.tsian-frontend.zip` → 另存本地副本卡 → 上传该包 → 确认前端行为一致。

24. **错误路径验证**
    - 上传缺 frontend.json 的包 → 报错且不破坏现有前端。
    - 上传 entry 不在 files 的包 → 报错。
    - 内置卡上传/导出/清除 → 按钮禁用或操作报错引导另存。

25. **回归验证**
    - 卡包整卡导入（`.tsian-card.zip`）仍能带入前端。
    - Remote URL 模式仍可用。
    - `npm run build:web` 通过。

### 阶段 6：Spec 更新

26. **更新 spec**
    - `.trellis/spec/platform-web/frontend/` 或 `contracts/frontend/` 记录：
      - 前端包格式 `tsian.frontend-package.v1` 规范（结构、清单字段、路径约定）。
      - SW DB 名须与 db.ts 一致的约束（防止再次漏改）。
      - packaged 前端 entry 落地带 `frontend/` 前缀的约定。
    - 使用 `trellis-update-spec` 或手动写入后确认索引。

## Validation Commands

```bash
# 类型检查
cd apps/platform-web && npx vue-tsc -b
# 构建
cd apps/platform-web && npm run build
# contracts 构建（若需）
cd packages/contracts && npm run build
```

## Review Gates

- R0（前置修复）后：端到端基线确认 packaged 前端能加载，才继续。
- R2（storage）后：import/export 往返自测通过。
- 阶段 5：全部验收标准逐条核对。
- 提交前：`trellis-check` 全量检查。

## Rollback Points

- R0：前置缺陷修复（独立有价值）。
- R2：storage 层（纯函数，独立有价值）。
- 阶段 3-4：host + UI 可一起提交。
