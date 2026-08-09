# 源码权威与验证研究（断点）

> 状态：研究已补齐。本文记录过规划期对双份源码和 raw-import 的调查；最终决策已覆盖早期建议：游戏卡前端权威是 `apps/play-frontend-dev/src/**`，卡内容权威是 `cards/沉浸阅读器.tsian-card/workspace/**`，内置模板不维护，卡目录 frontend/game-card 仅为导出残留。实施以 `design-resolution.md`、当前 PRD/design/implement 与项目 spec 为准。

## 已确认

### 1. 开发前端与打包卡前端是两份源码

- 开发入口：`apps/play-frontend-dev/src/**`。
- 卡内副本：`cards/沉浸阅读器.tsian-card/frontend/src/**`。
- `package.json:18` 的 `build:play-frontend` 只构建开发入口；`package.json:30` 的 `package:frontend` 调用 `scripts/package-play-frontend-source.mjs`，默认源目录为 `apps/play-frontend-dev/src`（脚本 `:9`），它是打包源码工具，不是已确认的就地同步命令。
- 两棵目录当前整体并不相同。最终决策不再同步它们：UI/composable/frontend 协议只改开发前端，卡内副本保留为历史导出残留。

### 2. 卡 workspace 与平台内置模板曾存在重复内容

- 正式可编辑卡内容位于 `cards/沉浸阅读器.tsian-card/workspace/**`。
- 部分平台模板直接 raw import 卡文件，例如 AIRP docs：`apps/platform-web/src/storage/workspace-templates/docs/airp.ts:1`；装备 Action/Skill 也采用 raw import。
- world-architect 开局 Skill 当前不是 raw import，而是在 `apps/platform-web/src/storage/workspace-templates/agents/world-architect.ts:18`、`:126` 中以字符串重复维护；Skill 文件映射见同文件 `:539`。
- 开局 browser scripts 又在 `apps/platform-web/src/storage/workspace-templates/scripts/opening.ts` 中重复为字符串常量，并由 `world-architect.ts:1-11` 引入；因此本任务若不改成单一 raw-import 权威，就必须同步维护 card workspace 与平台模板两份 AI-facing 契约。
- 当前还存在已知漂移：卡的 `agents/world-architect/agent.json:59-63` 启用了 `json_edit`/`text_edit`，平台模板 `world-architect.ts:503` 却是空 `tools.enabled`。最终决策是不再同步内置模板；这类差异不属于本任务。

### 3. 会话持久化契约

- `invokeAgent` 支持 `contextSlot` + `persist`，契约见 `packages/contracts/src/runtime.ts:819-843`。
- 同一 agent/slot 在平台按队列串行，见 `apps/platform-web/src/platform-host/ai-invocation.ts:201-217`。
- `persist:true` 从 `save/agents/<agentId>/context-<slot>.json` 读取并在成功后同事务写回，见 `ai-invocation.ts:263-267`、`:431-475`。
- 失败会丢弃整个本轮 workspace transaction，不会留下半轮写入，见 `ai-invocation.ts:500-515`。
- 当前 setup 已能从 `context-play-setup.json` 的 `recentTurns` 恢复 UI，见 `apps/play-frontend-dev/src/composables/useSetupState.ts:661-706`。
- 重要缺口：runtime 会收集本轮 `toolMemories`（`apps/platform-web/src/agent-runtime/index.ts:2154-2163`），但 `ai-invocation.ts:467-475` 调用 `stageAgentContextFile` 时未传 `toolMemories`，而 `stageAgentContextFile` 输入也无此字段（`platform-host/history-turns.ts:106-135`）。因此不能假设小说读取 action 的 observation 会跨访谈轮自动保留；新流程需要显式、可恢复的会话建模状态或等价修复，避免每轮重读小说。

### 4. 当前开局状态与正式完成信号

- 模板初始文件：`apps/platform-web/src/storage/workspace-templates/files.ts:116-121`，包括 pending `understanding-summary.json` 与 `setup-summary.json`。
- 当前前端通过 `setup-summary.status === "complete"` 判定访谈完成，见 `apps/play-frontend-dev/src/composables/useSetupState.ts:651-659`、`:822-829`。
- 点击“进入故事”后，`App.vue` 还要求 setup summary 已完成；因此保留独立确认屏可继续复用 `setup-summary` 的完成边界。
- `commit_play_setup` 当前一次写主角 traits、setup summary、turn 0 与正式 player-turn agent context，见 `cards/沉浸阅读器.tsian-card/workspace/agents/world-architect/skills/游玩设定/scripts/commit-play-setup.js:23-103`。

### 5. 当前建模校验顺序

- `commit_entities` 先写实体；`commit_scenes_and_relationships` 校验对已有实体的引用；`commit_runtime_and_frontier` 再校验场景/实体/source ref，证据分别见：
  - `开局建模/scripts/commit-entities.js:0-14`
  - `开局建模/scripts/commit-scenes-and-relationships.js:4-27`
  - `开局建模/scripts/commit-runtime-and-frontier.js:7-70`
- 这些 action 各自在一次 `invokeAgent` 的统一 workspace transaction 中暂存；若调用最终失败，平台丢弃整轮 transaction。因此可以在“完成轮”内按依赖顺序提交所有正式开局文件，避免跨多轮留下正式半成品。

### 6. 已知验证入口

- `npm run build:play-frontend`：构建开发版游戏前端（`package.json:18`）。
- `npm run build:web`：构建平台模板/宿主（`package.json:15`）。
- `npm run test:smoke:web`：现有 bridge + assistant runtime smoke（`package.json:24`）。
- `npm run test:frontend-actions:production-browser`：若 browser action 运行时或模板 action 发生结构性变化，可用于生产浏览器预检（`package.json:28`）。
- `git diff --check`：文本与同步修改基础检查。

## 补查结论

### 7. 不存在通用的 card/template 一致性命令

- 仓库搜索只发现对部分权威文件采用 `?raw` import：AIRP docs、装备 Action/Skill；没有发现将 world-architect 字符串模板与卡 workspace 做 diff 的通用脚本。
- 最接近的是装备专用 `apps/platform-web/src/platform-host/equipment-scripts/equipment-script-harness.ts:46-49`、`:132-155`、`:250-280`；它分别加载正式卡内容和内置模板，但没有现有 retained smoke 调用，也不能直接覆盖开局脚本。
- 早期曾考虑用 `?raw` import 消除重复；最终决策是不维护内置模板，因此本任务只修改卡 workspace，不建立新的模板同步关系。

### 8. 前端打包脚本不会同步卡目录

- `scripts/package-play-frontend-source.mjs:8-10` 定义默认输入与 zip 输出目录，`:133-177` 只遍历指定 `sourceDir`、生成 `frontend.json` 并写 zip；没有写 `cards/.../frontend/src` 或 `frontend/dist` 的逻辑。
- `--source` 只改变输入目录（`:45`、`:68-69`）；根脚本入口为 `package.json:30`。
- 这正是最终交付边界：`package:frontend` 只打包开发前端，平台上传后构建目标卡前端；卡内 frontend/dist/game-card 导出残留不再手工维护。

### 9. 开局 scripts 没有现成通用测试 harness

- 通用 Skill browser action runner 位于 `apps/platform-web/src/platform-host/browser-skill-script-executor.ts:1190-1305`，但现有测试没有直接调用它覆盖开局 action。
- 平台现有专用 harness 只有装备脚本与 Frontend Action preflight；搜索没有找到开局 action harness 或 retained smoke 覆盖。
- `.trellis/spec/platform-web/frontend/quality-guidelines.md:16-40`、`:52-90` 规定仓库为 smoke-only，禁止因 validator/UI 矩阵新增独立测试文件，除非用户显式批准并加入权威 smoke。
- 当前平台手写 `workspace-templates/scripts/opening.ts` 的字符串转义还可能使生成脚本与 card workspace 的真实可编译性不同，这是改用 raw import 的额外理由。
- 因此本任务不新增开局专用单测文件；通过 `build:web`、现有 smoke（只在修改宿主 invokeAgent/context 契约时）、对卡脚本做语法编译/解析 Skill `tsian-actions`，以及手工 action payload/端到端路径验证。

### 10. 保留 understanding-summary 兼容文件，不做 workspace migration

- `understanding-summary.json` 位于默认 save seed（`apps/platform-web/src/storage/workspace-templates/files.ts:119`）和 upgrade allowlist（`constants.ts:3-32`）。
- `apps/platform-web/src/storage/workspace.ts:279-317` 的升级只在旧版本且目标路径缺失时补文件，不覆盖同路径，也不负责删除旧文件。
- 删除或变更默认升级文件会扩大到 workspace version/migration；本任务设计已选择保留 pending 文件但停止当前前端/Skill 消费，符合“旧中间态不误判、新流程不依赖”的最小兼容策略。`opening-interview.json` 采用缺失时首次创建，无需加入 upgrade set 或提升 workspace version。

### 11. world-architect raw-import 方案（已被最终范围否决）

- 现有项目已经在 `workspace-templates/agents/stage-manager.ts:1-5`、`:225-234` 对 Agent Skill/scripts 使用 `?raw`，证明 Vite/TypeScript 构建链支持该模式。
- `workspace-templates/docs/airp.ts:1-2`、`:37-39` 也把正式卡文档作为内置模板权威；Frontend Action 同模式见 `workspace-templates/frontend-actions/equipment.ts:1-9`。
- 当前 world-architect 手写 Skill 常量始于 `workspace-templates/agents/world-architect.ts:18`、`:126`，映射在 `:538-558`；开局脚本副本位于 `workspace-templates/scripts/opening.ts:2-540`。
- 这些事实证明 raw import 在技术上可行，但用户已明确内置模板停止维护。本任务不修改 platform template；world-architect 合并开局 Skill、helper 和 action scripts 的唯一权威是卡 workspace。

## 最小充分验证命令

```bash
npm run build:play-frontend
npm exec vue-tsc -- --noEmit -p apps/play-frontend-dev/tsconfig.json
npm run package:frontend
git diff --check
```

- 若实现修改了平台 `invokeAgent` / context 持久化宿主契约，再运行 `npm run test:smoke:web`；仅改调用方、Skill 内容和 raw template imports 时不把该 smoke 描述为新行为证据。
- 修改 Frontend Action Worker/schema/preflight 才追加 `npm run test:frontend-actions:production-browser`；普通 Agent browser script 内容和 raw template imports不触发该重型 gate。
- 对本任务修改的卡脚本做语法编译并解析 Skill `tsian-actions` 声明。
- 手工验证原著/原创、刷新恢复、失败重试、旧完成/旧中间态、最终确认屏与 turn 0。
- 核对 `.tsian-frontend.zip` 的 `frontend.json` 与归档 `src/**` 清单，并逐文件验证路径、字节大小和内容均与 `apps/play-frontend-dev/src/**` 一致。
