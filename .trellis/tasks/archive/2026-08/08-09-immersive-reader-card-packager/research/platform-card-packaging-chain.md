# 平台整卡打包链证据

## 1. 当前命令与缺口

- 根 `package.json:31` 只有 `package:frontend`，调用 `scripts/package-play-frontend-source.mjs`。
- 该脚本只枚举 `apps/play-frontend-dev/src/**`，写入 `src/** + frontend.json`，默认输出 `tmp/frontend-packages/*-YYYYMMDD.tsian-frontend.zip`；见 `scripts/package-play-frontend-source.mjs:125-177`。
- 仓库没有已实现的 `package:card`、`repack:immersive-reader` 或整卡脚本。现有 `cards/沉浸阅读器.tsian-card.zip` 是导出产物，不是自动重建结果。

## 2. 已冻结的源码权威

`.trellis/spec/contracts/frontend/type-safety.md:37-110` 已定义：

- 前端源码权威：`apps/play-frontend-dev/src/**`；
- 卡内容权威：`cards/<card>.tsian-card/workspace/**`；
- 提取卡目录中的 `frontend/src/**`、`frontend/dist/**` 和 package-wrapper `game-card.json` 是导出残留，不得手工同步；
- 整卡打包器应把权威 workspace/cover 与新构建前端组装到 staging/ZIP，并只在产物中生成 `game-card.json`；
- 整卡打包器应验证源码树清洁、构建入口、manifest schema、archive/index 精确对应和 ZIP round trip。

上一任务 `.trellis/tasks/archive/2026-08/08-08-interview-driven-opening-modeling/prd.md:113-115` 将 `package:card` 明确拆为本后续任务。

## 3. 平台整卡导入/导出契约

`.trellis/spec/platform-web/frontend/type-safety.md:21-52` 与 `apps/platform-web/src/storage/game-card-packages.ts` 共同定义：

- ZIP 根清单为 `game-card.json`，允许的文件区是 `workspace/`、`frontend/`、`cover/`；不得包含 save/runtime 历史。
- 导入逐条执行路径安全、顶层目录、媒体类型和 inventory 校验；packaged frontend entry 必须真实存在，见 `game-card-packages.ts:553-645`。
- 导出从平台卡记录读取 workspace、frontend 和 cover，生成清单后压缩，见 `game-card-packages.ts:666-738`。
- 当前 exporter 对文本 workspace 的 size 使用 `file.content.length`，见 `game-card-packages.ts:691-695`；这统计 UTF-16 code units，而 ZIP 实际写入 `strToU8(file.content)`，见 `:721-726`。中文与 emoji 会产生错误 inventory，必须先改为实际 UTF-8 bytes。
- 当前仓库没有覆盖 `importGameCardPackage` / `exportGameCardPackage` 的专用测试。

## 4. 真实前端构建链

- `buildFrontend(cardId)` 从 IndexedDB 中的卡 manifest 与 `frontend/src/**` 读取源码，使用浏览器 `esbuild-wasm` 构建，再调用 `writeBackDist`；见 `apps/platform-web/src/frontend-build/engine.ts:272-369`。
- `writeBackDist` 生成 import map 与 `frontend/dist/index.html`，再通过 `replaceLocalGameCardFrontendDist` 全量替换 dist、清除 stale hash 文件；见 `apps/platform-web/src/frontend-build/write-back.ts:55-119`。
- 因此 Node/Vite 的开发 `dist` 不能替代该链。安全脚本需要用隔离浏览器/IndexedDB 创建临时卡，注入权威 workspace/cover/frontend source，执行 `buildFrontend → writeBackDist → exportGameCardPackage`，并把导出 bytes 交回 Node 验证与原子写出。
- 隔离 profile 不能连接或修改用户常用平台 IndexedDB；失败时不得触碰卡源目录或既有输出。

## 5. 与 07-21 任务的重叠

- `.trellis/tasks/07-21-card-inline-illustration-ui/design.md:453-459` 和 `implement.md:15,158-166` 已计划 `repack:immersive-reader`、UTF-8 exporter 修复、真实浏览器 build/write-back/export 和三方 inventory 对比，但尚未实现。
- 本任务应成为该打包工具能力的独立权威实现；后续 07-21 UI 任务应消费已完成命令，不再重复实现同一脚本。
- 07-21 计划中“回写 extracted card frontend/dist 与 game-card.json”早于最新源码权威规范；本任务遵循新规范，只写 staging/输出 ZIP，不把导出残留恢复为并行权威。

## 6. 最小安全架构建议

1. 修正并回归锁定 exporter 文本 UTF-8 size；明确 inventory size = 解压 ZIP entry bytes。
2. 提取或复用媒体类型、路径和 inventory 校验，避免 Node 脚本复制第二套包格式算法。
3. Node CLI 读取小型卡元数据输入、权威 workspace/cover 和开发前端 source，创建临时 staging 输入。
4. CLI 启动隔离浏览器链，导入临时卡、执行平台真实 build/write-back/export。
5. Node 对导出 ZIP 做双向 inventory、entry、byte-size、必需入口、源文件 byte-content 和无 save 路径验证。
6. 先写同目录临时文件，全部验证通过后再原子替换最终输出；失败删除临时产物并保留既有输出。

## 7. 已确认的输出策略

- 默认输出 `tmp/card-packages/沉浸阅读器-YYYYMMDD.tsian-card.zip`；同日目标已存在时追加递增序号，不覆盖已有文件。
- 只有显式 `--out <path>` 才替换指定目标；写出仍须先落同目录临时文件，全部验证通过后原子替换。

## 8. 其他待设计技术点

- 小型 author-owned manifest 输入的最终文件名与字段裁剪；不得继续把带 inventory 的导出 `game-card.json` 当作者源。
- 浏览器 harness 的最窄入口、临时服务生命周期、Windows profile 清理和下载/bytes 传递方式。
- `exportedAt` 等非语义字段在重复运行比较中的归一化策略。
