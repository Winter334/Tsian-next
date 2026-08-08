# 全仓测试主干收敛

## Goal

把仓库自动化验证收敛为少量、真实跨层、失败含义清晰的主干 smoke，并以显式构建和真实浏览器门槛补足运行环境风险。目标不是提高覆盖率，而是让测试维护成本、历史专项断言和排错噪音显著下降。

## Confirmed Facts

- 当前基线是 122 个 Vitest 文件、904 项 Vitest 测试和 6 个 Go 测试文件，共 128 个测试文件。
- 用户明确选择只保留集成 smoke；UI、Spatial、组件、controller、纯算法、validator、storage/host/bridge seam 等专项测试全部退出自动化测试集。
- 用户接受低层缺陷可能更晚在 smoke、真实浏览器门槛、手工 UI 测试或生产使用中暴露。
- UI 验证由用户手工完成；`npm run build:web` 只证明类型检查和打包完整性，不代表 UI 行为正确。
- Frontend Action 的 production-browser preflight 使用真实浏览器、生产 Ajv/Worker bundle 和 opaque-origin 隔离，不能由 Node、happy-dom 或 fake Worker 替代。
- 现有会话和测试数据无需迁移；项目仍在测试阶段，不为未使用数据承担兼容包袱。
- 当前四个未提交的 Agent Runtime 测试精简改动已被本任务的全仓方案覆盖，不作为独立成果提交；`.codex/config.toml` 是无关用户改动，必须保持不动。

## Requirements

### R1. 最终自动化拓扑固定为三条 smoke 主干

最终只保留以下三个测试文件：

1. `apps/platform-web/src/bridge/remote-iframe-bridge.test.ts`：Frontend Action 远程事务 smoke。
2. `apps/platform-web/src/integration/assistant-runtime.smoke.test.ts`：桌面助手、Agent Runtime、workspace、会话/context 和 diagnostics smoke。
3. `apps/platform-server/internal/server/market_test.go`：HTTP、认证、SQLite 和 blob storage smoke。

每条主干只包含一个成功场景和至多一个关键失败/回滚场景。

### R2. Web smoke 必须跨越真实业务边界

- Frontend Action smoke 必须使用真实 bridge lifecycle、execution service、workspace transaction 和 fake IndexedDB/Dexie commit；只允许用 deterministic scripted Worker 替代 Node 中不可运行的生产 Worker。
- Assistant smoke 必须从 `runAssistantChat` 进入，使用真实 Agent Runtime、Tool dispatch、workspace transaction、会话/context persistence 和 diagnostic storage；只允许替换外部 HTTP Provider、时间和不可避免的浏览器全局。
- 不得 mock `runAgentRuntimeTurn`、workspace commit、conversation/context persistence、diagnostic write 或 Frontend Action service/commit 后仍宣称跨层 smoke。

### R3. Server smoke 必须覆盖真实 HTTP 事务

Server smoke 使用 production router、session middleware、SQLite repository 和临时目录 blob store，保留一次登录后 upload/list/detail/download 成功，以及一次未登录 upload 返回 401 且无 DB/blob 副作用。

### R4. 真实浏览器与构建门槛保留

- 保留 `scripts/test-frontend-action-production-browser.mjs`、`apps/platform-web/runtime-preflight/**` 及其 Vite/preflight 依赖。
- 增加覆盖所有 workspace 与 Go server 的 `build:all`。
- 增加统一 `verify`，顺序执行 builds、三条 smoke 和 production-browser gate。
- 真实浏览器门槛不得降级为 Node/fake Worker 测试。

### R5. 退役其余自动化测试

删除其余 126 个现有测试文件，包括全部 UI、Spatial、组件、composable、controller、纯算法、validator、storage/host/bridge seam、play-frontend、play-bridge 和额外 Go 测试。不得为了让退役断言继续通过而修改生产行为。

### R6. 测试入口显式准入

- 根 `test` 改为执行 `test:smoke`，不再全仓自动发现 Vitest 文件。
- Web 和 Server smoke 使用显式文件/测试入口；新增测试文件不会仅因命名匹配就自动进入主门槛。
- 删除 `test:equipment`，将 `test:frontend-actions` 缩为 Frontend Action transaction smoke，并保持 production-browser 命令独立。
- 后续自动化测试只能扩展或替换现有 smoke；新增独立测试必须先取得明确范围决策并加入显式 smoke 入口。

### R7. 规范与新策略一致

保留各 spec 中的行为契约和 Validation/Error Matrix，但它们不再自动意味着每个分支都要有专项自动化测试。所有与 exhaustive unit/component/UI matrices 冲突的 `Tests Required` 表述必须同步为 smoke/build/manual 验证策略；UI/Spatial 行为明确归入手工验证。

### R8. 分批实施且保持可回滚

先建立并通过三条 smoke，再修改脚本，最后按已审计分组删除旧测试。每个阶段先运行相关 smoke/build，发生失败时回滚到上一个已通过阶段；如果真实跨层 smoke 只能依赖被禁止的 seam mock 或生产代码改造，停止并重新评审，不以弱化测试冒充完成。

## Acceptance Criteria

- [ ] AC1: 仓库最终恰好包含 2 个 Vitest 文件和 1 个 Go 测试文件；除这 3 个路径外不存在 `*.test.ts`、`*.test.tsx` 或 `*_test.go`。
- [ ] AC2: Frontend Action smoke 有一个 durable success/event-before-response 场景和一个 CAS conflict/zero-write/no-event 场景，并使用真实 service、transaction 与 Dexie commit。
- [ ] AC3: Assistant smoke 有一个 Tool write/read、workspace+conversation+context commit、sanitized diagnostic success 场景，以及一个后续 Provider 失败、workspace/session/context rollback、failed diagnostic 保留场景。
- [ ] AC4: Server smoke 有一个 authenticated upload/list/detail/download 场景和一个 unauthorized upload 无 DB/blob 副作用场景。
- [ ] AC5: `npm test` 只运行 smoke；`build:all` 覆盖全部 workspace 和 Go server；`verify` 覆盖 builds、smoke 和 production-browser gate；`test:equipment` 已删除。
- [ ] AC6: production-browser preflight 保持真实浏览器、生产 schema/Worker 和 equipment failure/zero-write 检查，不被 Node 测试替代。
- [ ] AC7: 全部 UI/Spatial/component/controller 及低层专项测试删除；没有为退役测试修改生产代码或产品行为。
- [ ] AC8: `.trellis/spec/` 中的测试准入和验证要求与 smoke-only 决策一致，不再要求已删除的专项矩阵。
- [ ] AC9: 最终记录测试文件数、Vitest 场景数和 Go 场景数的前后变化；运行 `npm run verify`、`git diff --check` 和 Trellis 校验均通过。
- [ ] AC10: `.codex/config.toml` 未被本任务修改或提交；此前四个未提交测试精简不单独保留。

## Out of Scope

- 自动化 UI、Spatial、视觉回归、可访问性或 controller 行为验证。
- 新增 Playwright、完整应用 E2E、覆盖率门槛或新的测试基础设施。
- 借测试清理修改生产功能、修复顺带发现的产品缺陷或增加 test-only 生产 seam。
- 迁移现有测试数据、历史会话或为已删除测试提供兼容层。
- 更新仓库外部 CI；仓库内只提供统一 `verify` 命令，外部调用方后续自行切换。

## Technical Notes

- `research/minimal-smoke-suite.md` 是最终测试拓扑和删除清单的权威研究。
- `research/runtime-platform-test-audit.md` 是早期保守审计，仍可用于理解原契约，但其 KEEP/MERGE 建议已被后续 smoke-only 决策明确取代。
- 当前无阻塞产品、范围、UX、兼容或风险决策。
