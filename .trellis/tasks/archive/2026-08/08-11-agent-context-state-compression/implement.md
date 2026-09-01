# 重构 Agent 上下文状态与压缩 — Implementation Plan

## Phase 1 — Contracts 与 context sequence

- [ ] 更新 `packages/contracts/src/runtime.ts`：Agent context v2、sequence/gameTurn、Tool Memory 语义字段、invokeAgent transcript opt-in 和 transcript 文件结构。
- [ ] 更新 context parser/serializer/path helpers，兼容读取 v1 `turn/lastCompressedTurn` 并只写 v2。
- [ ] 让 formal turn、桌面助手和 persistent invokeAgent 都显式分配 context sequence；游戏 turn 仅作关联。
- [ ] 补 parser 升级、连续 invokeAgent、失败不推进和不同 slot 隔离测试。

Validation gate:

```powershell
npm run build:contracts
npm exec vitest run -- apps/platform-web/src/agent-runtime/context-lifecycle.test.ts apps/platform-web/src/integration/assistant-runtime.smoke.test.ts
```

## Phase 2 — 固定压缩契约

- [ ] 将三类 compression kind、固定 Markdown prompt、section parser/validator 和一次 repair 封装到 context lifecycle。
- [ ] task 跨轮快照使用 continuation contract；同轮工具压缩使用 checkpoint contract；narrative 使用剧情 contract。
- [ ] 以工具交互原子组识别并 pin 最新未解决精确操作；后续成功按 supersession key 解除旧失败。
- [ ] 增加角色无关权威、缺失片段不作全局否定、精确标识符、旧摘要 supersession、非法摘要 repair/失败测试。

Validation gate:

```powershell
npm exec vitest run -- apps/platform-web/src/agent-runtime/context-lifecycle.test.ts
npm run build:web
```

## Phase 3 — Skill action 解门禁与 Tool Memory 投影

- [ ] 把 `use_skill` 改为纯说明加载；`run_script` 从当前可见/启用 Skill 懒解析 action，session cache 仅作优化。
- [ ] 删除 `SKILL_NOT_ACTIVATED` 和持久 activation 语义，保留 visibility、declaration、executor policy、workspace scope 校验。
- [ ] 实现内置 Tool Memory projector registry、omit 规则、supersession/resolve 合并和最终预算保险。
- [ ] 在 browser-script Worker/runner 增加有界 `tsian.memory.set()` side channel，并接入 Skill action 与 Agent Tool observation 的内部投影。
- [ ] 为隐藏/禁用 action、无需 use_skill 执行、use_skill 不持久化、source 正文不持久化、写入 receipt、失败被成功清除增加测试。

Validation gate:

```powershell
npm exec vitest run -- apps/platform-web/src/agent-runtime/workspace-tools apps/platform-web/src/agent-runtime/tool-memory.test.ts apps/platform-web/src/integration/assistant-runtime.smoke.test.ts
npm run build:web
```

## Phase 4 — invokeAgent transcript 与恢复基础设施

- [ ] 实现宿主派生 transcript path、严格 parser/serializer 和 append-only entry 合并。
- [ ] 校验 full/player transcript 仅用于 persist + slot；在 owning workspace transaction 中同步 stage context/transcript。
- [ ] transcript 保存投影后的 assistant content/display/projections 和有界 UI timeline，但不进入模型预算或 Tool Memory。
- [ ] 覆盖后台 persistent 无 transcript、玩家会话完整恢复、并发 slot 排队、失败/回滚不追加测试。

Validation gate:

```powershell
npm exec vitest run -- apps/platform-web/src/platform-host/ai-invocation.test.ts apps/platform-web/src/integration/assistant-runtime.smoke.test.ts
npm run build:contracts
npm run build:web
```

## Phase 5 — 开局 progress action 与 frontend 切换

- [ ] 在卡片《开局建模》Skill 中新增 progress schema、`read_opening_progress` 和 `advance_opening_progress` actions/scripts；实现 CAS、幂等、继承、readSlices 和 phase 校验。
- [ ] 让 `commit_opening` 读取 progress 前置条件并在成功事务内写 `phase:complete`。
- [ ] 改造 Skill：每轮 action 读写权威进度，玩家回复不再输出 `[[开局会话]]`；保留有效的角色分支和用户已修改的“只问会改变正式模型/首回合内容”规则。
- [ ] 改造 opening frontend：invokeAgent 开启 full/player transcript，本轮结果用 progress/control 验证，恢复从 transcript + progress/control 重建。
- [ ] 删除 opening state block parser、reply projection opening-state 规则和过期 README；保留 opening choices projection。
- [ ] 同步 `apps/play-frontend-dev/src` 与卡包 workspace frontend 源的生成边界，不手改 `frontend/dist`。

Validation gate:

```powershell
npm exec vitest run -- apps/play-frontend-dev/src/lib/opening-interview.test.ts apps/platform-web/src/platform-host/ai-invocation.test.ts
npm run build:play-frontend
```

## Phase 6 — `commit_opening` 批量领域校验

- [ ] 在 `commit-opening.js` 内引入最多 32 条 issue collector、section capture 和 prerequisite gating。
- [ ] 聚合 entity、scene、relationship、runtime、frontier、summary 与 openingReply 可独立发现的问题；避免依赖无效前提产生级联错误。
- [ ] 保持通用 `validateActionInputSchema()` 的既有浅层 fail-fast 契约，不扩大为全局 JSON Schema all-errors。
- [ ] 确保 issue 存在时零 workspace write，并测试多个 issue、截断标记、fatal external prerequisite 与正常/幂等提交。
- [ ] 同步卡片 workspace script 与平台 workspace template 中对应生成源。

Validation gate:

```powershell
npm exec vitest run -- apps/platform-web/src/platform-host/browser-skill-script-executor.test.ts apps/platform-web/src/integration/opening-commit.test.ts
npm run build:web
```

## Phase 7 — world-architect 常驻上下文精简

- [ ] 记录当前 `agent.json contextPaths`、注入文件字符数和重复段。
- [ ] 按 design §9 重写 schema guide/current schema/README/AGENT/Skill 的单一职责，并调整 contextPaths。
- [ ] 同步卡片 workspace 与 `apps/platform-web/src/storage/workspace-templates/**`，检查无过期 `[[开局会话]]`、activation 或 Tool Memory 说明。
- [ ] 添加装配快照/断言，证明必要动态上下文仍存在且常驻字符数显著下降。

Validation gate:

```powershell
npm exec vitest run -- apps/platform-web/src/agent-runtime/context.test.ts apps/platform-web/src/storage/workspace-templates
npm run build:web
```

## Phase 8 — 全量验证、卡包重建与审查

- [ ] 运行所有新增 focused tests 和既有 Web smoke。
- [ ] 运行 contracts、platform web、play bridge（若 contract 消费受影响）和 play frontend builds。
- [ ] 用临时输出执行卡包构建/导入验证，再运行项目约定的沉浸阅读器重打包，确认 hash/manifest 与 workspace/frontend 源一致。
- [ ] 检查模型上下文不含 Skill/source 正文 Tool Memory、后台 invokeAgent 不生成 transcript、formal/assistant 完整历史不回归。
- [ ] 运行 `git diff --check`，复核用户原有 Skill 修改未被覆盖，删除临时包。
- [ ] 浏览器真实开局集成测试留给用户手动完成并在交付中明确。

Validation gate:

```powershell
npm run build:contracts
npm run build:play-bridge
npm run build:web
npm run build:play-frontend
npm run test:smoke:web
npm run package:card -- --out tmp/card-packages/agent-context-state-compression.tsian-card
git diff --check
```

## Rollback points

- Phase 1/2/3 为平台通用层，按 contract + runtime 成组回退；不要留下 parser 与 serializer 版本不一致。
- Phase 4 的 transcript 为 opt-in，可先撤调用方再撤宿主能力。
- Phase 5/6/7 的 opening frontend、Skill、scripts、reply projection、README 与模板必须成组回退。
- 卡包重建放在最后；若验证失败，删除临时输出，不覆盖权威 workspace/frontend 源。

## Pre-start review

- [ ] `prd.md`、`design.md`、`implement.md` 无阻塞开放问题。
- [ ] `implement.jsonl` 与 `check.jsonl` 均为真实 spec/research 条目。
- [ ] 用户在最终规划摘要之后重新明确批准实施，才运行 `task.py start`。

