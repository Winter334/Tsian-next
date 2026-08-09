# 沉浸阅读器整卡打包器：实施计划

## 0. 基线与上下文

- [ ] 读取 source ownership、game-card package、platform quality 与研究文档。
- [ ] 记录基线：`npm run build:web`、`npm run build:play-frontend`、`npm run test:smoke`。
- [ ] 确认既有 `.trellis/.template-hashes.json` 与 `cards/沉浸阅读器.tsian-card.zip` 不属于任务变更。

## 1. Author manifest 与 exporter 字节契约

- [ ] 新增 `cards/沉浸阅读器.tsian-card/card-manifest.json`，只保存现有 inner manifest 的稳定作者字段。
- [ ] 修正 workspace 文本 inventory size 为实际 UTF-8 entry bytes，不改变其他导入/导出字段语义。
- [ ] 增加 ASCII、中文、emoji、binary 的真实 ZIP entry byte-size regression，先让旧实现失败，再验证修复。

## 2. 隔离浏览器打包链

- [ ] 提取/复用现有 headless browser 发现、临时 profile、超时和清理 helper，保持 production-browser preflight 行为不变。
- [ ] 新增 card-package Vite browser harness：接收输入、写临时 IndexedDB 卡、构建前端、导出整卡并返回 bytes/error。
- [ ] 确认 harness 直接调用 `buildFrontend` / `writeBackDist` / `exportGameCardPackage`，不复制平台包格式或使用开发 Vite dist。
- [ ] 确保 harness 只使用临时 profile/origin，完成后无平台用户数据残留。

## 3. Node CLI 与 root 命令

- [ ] 新增整卡 CLI，读取 author manifest、权威 workspace/cover/frontend src，执行路径与保留目录校验并冻结输入快照。
- [ ] 新增 `package:card`；将 `repack:immersive-reader` 设为同一实现别名；保留 `package:frontend`。
- [ ] 实现默认 `tmp/card-packages/沉浸阅读器-YYYYMMDD.tsian-card.zip`、同日递增序号与 `--out`。
- [ ] 实现 raw ZIP 接收、双向 inventory/entry/mediaType/size/source-byte 验证及无 save 校验。
- [ ] 实现同目录临时文件发布、显式覆盖 backup/swap/rollback 和失败清理。
- [ ] 输出产物路径、文件分类数量、构建入口与校验摘要。

## 4. 自动验证

- [ ] `npm run build:contracts`
- [ ] `npm run build:web`
- [ ] `npm run build:play-frontend`
- [ ] `npm run test:smoke`
- [ ] `npm run test:frontend-actions:production-browser`
- [ ] `npm run package:frontend` 并核对 source manifest。
- [ ] `npm run package:card`，解压核对最新角色选择源码、dist entry、workspace、cover 与 manifest。
- [ ] 连续打包两次，忽略 exportedAt 后 manifest/inventory 语义一致且无 stale dist。
- [ ] 使用临时显式 `--out` 验证覆盖成功与失败回滚。
- [ ] `git diff --check`

## 5. 集成验收

- [ ] 平台导入生成的整卡包成功，不创建或携带 save。
- [ ] packaged iframe 加载无资源/bridge 错误。
- [ ] 新建存档进入最新开局向导并看到已更新的角色类型卡片。
- [ ] 将 07-21 UI 任务中的重复 repack 实现视为本任务已提供的依赖，不再重复编码。

## 6. 风险与回滚点

- exporter 修改后先完成 UTF-8/binary regression；失败时只回滚该窄改动。
- browser harness 不得接触真实平台 profile；发现隔离不成立立即停止。
- 输出发布前不修改目标；显式覆盖必须保留可恢复 backup 到新目标就位。
- 不修改 extracted card `frontend/**`、`game-card.json` 或现有整卡 ZIP，除非用户在命令行显式传入该 ZIP 作为 `--out`。
