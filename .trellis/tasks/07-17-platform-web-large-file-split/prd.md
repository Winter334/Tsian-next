# Platform Web 大文件拆分

## Goal

把 `apps/platform-web` 中已经明显膨胀的源码文件拆成按责任边界组织的 focused modules，降低 review 噪音、冲突概率、语言服务负担和未来功能继续堆进 god file 的风险。

本父任务只负责总体拆分地图、统一约束、子任务顺序、跨子任务验收与最终集成检查。实际代码拆分由子任务独立完成、独立验证、独立归档。

## Background / Evidence

已排除 `tmp/` 临时文件干扰后，当前非临时源码大文件集中在 `platform-web`：

| File | Current size | Initial handling |
|---|---:|---|
| `apps/platform-web/src/storage/workspace-templates.ts:1` | 3674 lines / 257.7 KiB | P0，模板/默认文件数据堆积，优先拆 |
| `apps/platform-web/src/runtime-host/ai.ts:1` | 2691 lines / 96.8 KiB | P1，按 provider / request / stream / debug / probe 拆 |
| `apps/platform-web/src/agent-runtime/workspace-tools.ts:1` | 2593 lines / 83.3 KiB | P1，按 tool parsing / trace / executor / agent-call 拆 |
| `apps/platform-web/src/agent-runtime/index.ts:1` | 2418 lines / 101.1 KiB | P1/P2，核心主编排，必须在 workspace tools 拆分后谨慎收敛 |
| `apps/platform-web/src/views/AssistantView.vue:1` | 2148 lines / 89.3 KiB | P2，按 route shell、子组件、composables 拆 |
| `apps/platform-web/src/platform-host/index.ts:1` | 1651 lines / 63.5 KiB | P2，目录规范已要求其作为 barrel + bridge assembly 边界 |

相关项目约束：

- `.trellis/spec/guides/module-structure-guide.md:8`：拆分依据是责任边界，不是机械行数。
- `.trellis/spec/guides/module-structure-guide.md:53`：一条 seam 一次 green build；失败时可回滚当前 seam。
- `.trellis/spec/platform-web/frontend/index.md:17`：任何 `apps/platform-web` 改动需要 `npm run build:web`。
- `.trellis/spec/platform-web/storage/index.md:24`：内置空白卡种子依赖默认 Runtime Workspace 模板，拆 `workspace-templates.ts` 必须保持默认文件内容/升级行为兼容。
- `.trellis/spec/platform-web/frontend/directory-structure.md:20`：`platform-host/index.ts` 应保持 barrel + `playFrontendBridge` assembly + re-export 边界，新职责不得继续堆入。

## Child Task Map

1. `07-17-split-workspace-templates/` — 拆 `storage/workspace-templates.ts`。
2. `07-17-split-ai-config-runtime/` — 拆 `config/ai.ts` 与 `runtime-host/ai.ts`。
3. `07-17-split-agent-runtime-workspace-tools/` — 拆 `agent-runtime/workspace-tools.ts`。
4. `07-17-split-agent-runtime-index/` — 在 workspace tools 拆分后收敛 `agent-runtime/index.ts`。
5. `07-17-split-platform-host-index/` — 拆 `platform-host/index.ts` 中仍混杂的宿主职责。
6. `07-17-split-assistant-view/` — 拆 `views/AssistantView.vue`。

推荐顺序：1 → 2 → 3 → 4 → 5 → 6。

## Requirements

- R1. 父任务必须维持一张明确的子任务地图，每个子任务拥有独立 PRD/design/implement，不在父任务内直接改源码。
- R2. 每个子任务必须按自然责任 seam 拆分，禁止按固定行数切文件。
- R3. 每个子任务默认只做结构性拆分，不改变运行时行为、默认数据内容、对外 API、持久化 schema 或 UI 交互；确需行为变化时必须先回到规划并单独确认。
- R4. 每个子任务开始实现前必须建立可回滚基线：确认工作树状态、记录 baseline commit、创建本地备份 ref/branch，并在每个高风险 seam 后保留 patch 或提交检查点（提交需另行授权）。
- R5. 每个子任务应尽量保留原 import path 作为 barrel/re-export 边界，让消费者迁移最小化。
- R6. 每个子任务必须在拆分后清理死 import、避免 barrel ↔ submodule 循环依赖，并运行 `npm run build:web`。
- R7. 父任务完成前必须做一次跨子任务集成复核：文件大小下降、公共导出稳定、构建通过、无临时备份/patch 误入最终代码路径。

## Acceptance Criteria

- [ ] 已创建并链接 6 个子任务，且每个子任务有面向自身文件特点的拆分策略。
- [ ] 每个子任务的规划中都包含备份/回滚步骤，不允许无基线直接改大文件。
- [ ] 每个子任务完成后 `npm run build:web` 通过，失败结果必须如实记录并回滚或修复。
- [ ] 父任务最终复核确认目标大文件不再作为新职责堆积点；保留下来的大文件必须有明确理由。
- [ ] 父任务最终复核确认没有改变 AI provider 行为、Agent Runtime turn 语义、默认 workspace 文件内容、platform bridge API 或 Assistant UI 行为，除非对应子任务获得单独批准。

## Out of Scope

- 不处理 `tmp/` 临时文件；其 Git 干扰已通过本地 exclude + skip-worktree 屏蔽。
- 不把所有 1000+ 行文件一次性纳入本轮；除非用户扩大范围。
- 不做性能优化、UI redesign、AI provider 功能新增、Dexie schema 改动或 bridge contract 改动。
- 不自动提交或 push；提交仍需用户单独授权。

## Scope Decision

- 本轮限定为当前 6 个子任务，不扩展到所有 1000+ 行源码文件。
- 未纳入本轮的大文件可在父任务最终复核后再决定是否进入下一轮。
