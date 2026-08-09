# 实现沉浸阅读器整卡打包脚本

## Goal

提供一个可重复执行的 `package:card` 流程，把沉浸阅读器的开发前端、卡内容 workspace、封面与卡元数据组装为可直接导入平台的 `.tsian-card.zip`，避免目前“先导入旧整卡、再单独上传前端包”的两步测试流程和手工同步风险。

## Background

- 根脚本目前只有 `npm run package:frontend`，产物是 `.tsian-frontend.zip`，不是完整游戏卡包。
- `cards/沉浸阅读器.tsian-card.zip` 是已有导出产物，其内前端源码和构建产物会落后于 `apps/play-frontend-dev/src/**`。
- 上一任务已确认：`apps/play-frontend-dev/src/**` 是游戏卡前端源码权威；`cards/沉浸阅读器.tsian-card/workspace/**` 是 Skill、Tool、Agent、config 与 docs 的卡内容权威。
- 卡目录中既有 `frontend/**` 与 `game-card.json` 是早期导出残留，不应继续靠手工复制维持同步。
- 前端源码包由平台“上传前端包”后走浏览器构建并写回 packaged frontend；开发前端的普通 Vite `dist` 不能自动等同于平台导出的整卡前端产物。
- 完整卡包格式为 `tsian.game-card.package.v1`，根目录包含 `game-card.json`，并按需包含 `workspace/`、`frontend/`、`cover/` 文件区。
- 平台 exporter 当前把文本 workspace 的 inventory size 写成 UTF-16 `content.length`，但 ZIP 实际使用 UTF-8 bytes；中文与 emoji 会不一致，必须在打包器依赖该清单前修正并增加回归。
- 平台真实前端构建链是 IndexedDB 卡源码 → `buildFrontend` → `writeBackDist` 全量替换 dist → `exportGameCardPackage`；打包脚本需要在隔离浏览器状态中驱动该链。
- 活跃的 `07-21-card-inline-illustration-ui` 规划曾把同一 repack tooling 纳入其范围但尚未实现；本任务将独立拥有该能力，后续任务只消费它，避免重复实现。

## Requirements

### R1 新增整卡打包入口

- 在根 `package.json` 新增清晰的整卡打包命令，默认面向沉浸阅读器。
- `package:card` 是正式命令；为兼容已有 `07-21` 规划，可保留 `repack:immersive-reader` 作为同一实现的别名，不维护第二套逻辑。
- 保留现有 `package:frontend`，两者职责不能混淆。
- 命令应支持显式输出路径，并报告最终产物位置、文件数量和关键校验结果。
- 默认写入 `tmp/card-packages/沉浸阅读器-YYYYMMDD.tsian-card.zip`；同日目标已存在时追加递增序号，不覆盖已有文件。只有调用者显式传入 `--out <path>` 时才替换该目标，并且仍须采用临时文件 + 成功后原子替换。

### R2 使用正确的源码权威

- 前端输入来自 `apps/play-frontend-dev/src/**`，不得把卡目录既有 `frontend/src/**` 当权威。
- 卡内容输入来自 `cards/沉浸阅读器.tsian-card/workspace/**`；封面来自该卡源目录的 cover 输入。
- 新增一个不含 inventory/exportedAt 的小型作者元数据文件，保存当前 `game-card.json.manifest` 的稳定字段；版本由作者显式维护，打包不自动改写源码或递增版本。
- `game-card.json` 只在产物组装阶段生成；不得要求开发者手工维护派生 inventory 与构建输出。
- 不修改平台内置 workspace 模板，不包含任何 save 数据。
- 打包成功也不回写卡目录中的历史 `frontend/**`、`game-card.json` 或其他导出残留。

### R3 复用平台真实前端构建与卡包契约

- 产物中的 packaged frontend 必须与平台实际支持的浏览器构建、写回和导出格式一致，不能用“复制开发 Vite dist”冒充平台构建结果。
- 卡包清单中的 workspace/frontend/cover inventory 必须与 ZIP 实际条目双向一致，文本与二进制大小都使用真实 ZIP entry 字节数。
- 失败时不得覆盖已有可用产物，也不得留下被部分更新的卡源目录。

### R4 可重复与可验证

- 相同源码重复打包应得到语义一致的 manifest 与 inventory；时间戳等非语义字段的策略在设计阶段明确。
- 打包前后验证必需入口、媒体类型、路径安全、重复条目、缺失/多余 inventory 和 packaged frontend 可加载性。
- 产物应能由平台整卡导入流程成功安装，并在新存档进入最新开局向导。

## Acceptance Criteria

- [ ] 存在一个文档化的根命令，可一键生成沉浸阅读器 `.tsian-card.zip`。
- [ ] 产物使用 `apps/play-frontend-dev/src/**` 的最新源码和卡 workspace/封面权威输入，不依赖手工同步导出残留。
- [ ] 产物包含平台真实构建后的 `frontend/dist/**`、最新 `frontend/src/**`、完整 workspace 与封面。
- [ ] `game-card.json` 的 schema、frontend binding 和三类 inventory 与 ZIP 条目双向一致，中文/emoji 文本和 binary size 正确。
- [ ] 任一构建、导出或校验失败时，既有输出文件和卡源目录保持不变。
- [ ] 连续运行两次不会产生 stale frontend 文件，且 inventory 语义一致。
- [ ] 平台能够导入生成的整卡包，并在 packaged iframe 中加载前端；新开局能看到最新角色选择页。
- [ ] 相关平台、开发前端、脚本测试与构建验证通过。

## Out of Scope

- 把打包器泛化为任意第三方游戏卡的公共发布系统。
- 修改沉浸阅读器的业务功能、开局流程或卡内容。
- 迁移用户已安装的本地卡或存档。
