# 沉浸阅读器整卡打包器：技术设计

## 1. 设计边界

本任务提供一个沉浸阅读器专用、可重复执行的整卡打包链。它修正平台整卡 exporter 的真实字节契约，并用隔离浏览器复用现有平台构建与导出能力。

本任务不把打包器泛化为第三方卡发布框架，不修改卡业务内容，不把 `cards/沉浸阅读器.tsian-card/frontend/**` 或现有 package-wrapper `game-card.json` 恢复为作者权威。

本任务不拆父/子任务：UTF-8 inventory 修复、浏览器构建 harness 与 CLI 是同一条端到端链的前置条件，无法独立交付可导入产物；拆分会制造跨任务半成品。

## 2. 权威输入与产物

### 2.1 作者输入

```text
cards/沉浸阅读器.tsian-card/card-manifest.json    # 新增：只含 tsian.game-card.v1 manifest
cards/沉浸阅读器.tsian-card/workspace/**          # 卡内容权威
cards/沉浸阅读器.tsian-card/cover/**              # 封面源
apps/play-frontend-dev/src/**                      # 前端源码权威
```

`card-manifest.json` 初始内容来自现有 `game-card.json.manifest`，保留 id/name/version/summary/author/cover/frontend/runtime 等稳定字段。它不包含 package schema、inventory、`exportedAt` 或 exporter 信息。版本只由作者修改；打包器不改源文件和版本。

### 2.2 非权威输入

以下现有文件仅作历史参考，不参与打包：

```text
cards/沉浸阅读器.tsian-card/frontend/**
cards/沉浸阅读器.tsian-card/game-card.json
cards/沉浸阅读器.tsian-card.zip
apps/play-frontend-dev/dist/**
```

### 2.3 输出

正式命令：

```bash
npm run package:card
```

默认输出：

```text
tmp/card-packages/沉浸阅读器-YYYYMMDD.tsian-card.zip
```

显式输出：

```bash
npm run package:card -- --out cards/沉浸阅读器.tsian-card.zip
```

为兼容已存在的 07-21 规划，`npm run repack:immersive-reader` 调用同一脚本和参数，不复制实现。

## 3. 完整数据流

```text
Node CLI
  ├─ 读取/校验 card-manifest.json
  ├─ 枚举 workspace、cover、play frontend src
  ├─ 构建 card-package browser harness
  ├─ 启动临时 HTTP server + 隔离 Chrome/Edge profile
  └─ 提供输入文件快照
          ↓
隔离浏览器（临时 IndexedDB）
  ├─ putLocalGameCard：manifest + workspace + frontend/src
  ├─ writeLocalGameCardContentFile：二进制 cover
  ├─ buildFrontend(cardId)
  ├─ writeBackDist：全量替换 frontend/dist
  └─ exportGameCardPackage(cardId) → ZIP bytes
          ↓
Node CLI
  ├─ 解压并双向验证 game-card.json / ZIP entries
  ├─ 比对权威 src/workspace/cover byte content
  ├─ 验证 dist/index.html、路径、mediaType、size、无 save
  └─ 同目录临时文件 → 成功后原子/可回滚替换最终输出
```

浏览器必须使用临时 user-data-dir 和临时 origin；不得连接用户日常平台实例或其 IndexedDB。无论成功失败都关闭浏览器、HTTP server 并清理 profile/staging。

## 4. 平台 exporter 修正

`apps/platform-web/src/storage/game-card-packages.ts` 的 workspace inventory 统一定义：

```text
size = 对应解压 ZIP entry 的 Uint8Array.byteLength
```

文本文件使用 `strToU8(file.content).byteLength`，binary 使用 Blob/Uint8Array byte length。字段可选性、媒体类型与其他导入行为不变。

必须有自动回归覆盖 ASCII、中文、emoji（代理对）和 binary，并在解压后断言 manifest size 等于 entry bytes。测试可放在新的 card-package browser harness / packager preflight 中，不为此恢复被仓库测试策略移除的大型单测矩阵。

## 5. 浏览器 harness 与代码复用

新增窄用途的 production browser harness（具体目录名可按现有 `runtime-preflight` 约定调整），只暴露打包所需入口：

- 从本地 server 读取一次输入快照；
- 在临时 IndexedDB 写入一张卡；
- 调用现有 `buildFrontend`、`writeBackDist` 和 `exportGameCardPackage`；
- 以原始二进制响应把 ZIP 交回 Node；
- 将结构化错误回传给 CLI。

浏览器发现、临时 profile、headless 启动、超时与清理应从 `scripts/test-frontend-action-production-browser.mjs` 提取最小共享 helper，或以不改变现有 preflight 行为的方式复用。不得复制两套浏览器候选与生命周期算法。

包格式、媒体类型、路径规范与 exporter 只保留平台现有实现一份。Node 侧 verifier 是独立的消费者校验，不重新生成第二份权威 manifest。

## 6. 输入枚举与安全

- 文件枚举按规范化 `/` 路径排序；拒绝绝对路径、`..`、反斜杠、NUL、重复路径和大小写冲突。
- workspace 只接受当前源树的文本文件；若未来出现二进制 workspace，必须显式支持，不能静默 UTF-8 解码。
- `workspace/save/**`、`workspace/.tsian/**` 和其他运行时路径拒绝打包。
- frontend source 必须含 `src/main.ts`；最终输出必须含 `frontend/dist/index.html`。
- cover 路径必须与 author manifest 的 `cover.workspacePath` 对应；当前 `.cover/cover.png` 映射到 package `cover/cover.png`。
- 所有输入在启动浏览器前快照为 bytes，构建期间源文件变化则由最终 byte-content 对比或可选 stat guard 令本次失败，避免混合版本。

## 7. 输出原子性与重复执行

CLI 先把浏览器导出 bytes 写到最终目录中的唯一临时文件，完成全部验证后再发布：

- 默认日期目标若已存在则选择递增序号的新文件，再同目录 rename；
- 显式目标已存在时，使用同目录 backup + rename swap；若发布失败则恢复 backup；
- 只有新目标已就位后才删除 backup；
- 任何早期错误都只清理临时文件，不触碰已有输出。

重复执行比较时忽略 `exportedAt` 等非语义字段；其余 manifest、inventory、src/workspace/cover bytes 与构建产物集合必须一致。构建输出不能残留上一轮 hashed 文件，因为每次都在新的隔离卡上执行 `writeBackDist` 全量替换。

## 8. 校验矩阵

| 条件 | 结果 |
|---|---|
| author manifest 缺失/非法 | 浏览器启动前失败，零输出 |
| frontend `src/main.ts` 缺失 | 浏览器启动前失败 |
| 路径不安全、重复或命中 save/.tsian | 失败 |
| Chrome/Edge 不存在 | 给出 `TSIAN_BROWSER_PATH` 指引，保留旧输出 |
| browser build/write-back/export 失败或超时 | 关闭并清理隔离环境，保留旧输出 |
| dist entry 缺失 | 验证失败 |
| inventory missing/extra/type/size mismatch | 验证失败 |
| UTF-8/emoji/binary fixture size 不等于 entry bytes | preflight 失败 |
| 权威 input 与导出 entry bytes 不一致 | 验证失败 |
| 显式覆盖发布失败 | 恢复 backup，报告失败 |

## 9. 验证与回滚

最低验证：

```bash
npm run build:contracts
npm run build:web
npm run build:play-frontend
npm run test:smoke
npm run test:frontend-actions:production-browser
npm run package:frontend
npm run package:card
npm run package:card -- --out <temporary-explicit-path>
git diff --check
```

额外验证：连续运行两次并比较归一化 manifest/inventory；导入产物、加载 packaged iframe，并新建存档确认最新开局向导。

回滚顺序：移除新 root scripts/CLI/harness/shared helper，恢复 exporter size 修正及 author manifest。输出位于 `tmp/` 或显式用户路径，不纳入源码回滚；卡源目录和用户平台数据从未被打包链修改。
