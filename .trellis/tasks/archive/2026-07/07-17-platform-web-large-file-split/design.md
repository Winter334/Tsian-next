# Design: Platform Web 大文件拆分

## Architecture

本任务采用 parent / child program 结构：

- Parent：维护拆分原则、顺序、统一备份/回滚规则、跨子任务最终复核。
- Child：负责一个文件或高度耦合的一组文件，独立完成设计、实现、检查。

不把所有拆分压成一个大变更，原因：

- 大文件拆分主要风险来自移动代码时引入 import 循环、遗漏导出、破坏初始化顺序。
- 一次只拆一个 seam，才能把失败回滚范围限定到当前 seam。
- `npm run build:web` 成本可接受，适合作为每个 seam / 子任务的绿灯。

## Split Principles

1. **责任边界优先**：以 call graph、数据来源、外部依赖、对外导出分组，而不是按行数切割。
2. **原路径稳定**：优先保留原文件作为 barrel 或 facade，让消费者 import path 不变。
3. **单向依赖**：submodule 不 import barrel；共享 helper 下沉到 `shared` / `types` / `state` 类内部模块。
4. **行为冻结**：默认不改条件分支、默认值、schema、prompt/tool 文本、UI 文案与事件流。
5. **小步绿灯**：每拆一个明显 seam 后执行至少 `git diff --check` 与 `npm run build:web`。

## Child-Specific Strategy Summary

### `workspace-templates.ts`

数据/模板文件堆积。拆分为默认 workspace 文件列表、agent seed、skill/tool seed、AIRP docs、脚本模板等模块。核心风险是文本内容变化，因此需要拆前/拆后内容快照比对。

### `config/ai.ts` + `runtime-host/ai.ts`

AI 配置与调用 runtime 膨胀。拆分为 types/defaults/normalizers/provider metadata/request builders/stream parsers/debug records/probes/tool-call helpers。核心风险是 provider 行为变化，因此要保持 request body、URL、参数归一化和 debug record shape 兼容。

### `workspace-tools.ts`

Agent Runtime tool 入口承担解析、trace、observation、action executor、agent call 等多类职责。先抽无状态 helper，再抽 executor clusters，最后保留原文件 re-export。核心风险是 trace/event 内容和 tool observation shape 变化。

### `agent-runtime/index.ts`

主编排文件，依赖上一项拆分减压后再动。只移动可独立验证的辅助逻辑：history span、context injection formatting、message rendering、loop helpers 等。核心 turn orchestration 留在主文件或明确 facade 中。

### `platform-host/index.ts`

目录规范已要求其作为 barrel + bridge assembly。继续拆剩余 action/resource/runtime trace/invocation 逻辑到 focused host modules。核心风险是 bridge API 与 active save lifecycle。

### `AssistantView.vue`

Route-level Vue 文件。拆成 route shell、session sidebar、message list、composer、ask dialog 和 composables。核心风险是交互状态/scroll/focus/attachment 行为。

## Backup / Rollback Design

每个 child 实现前必须执行并记录：

1. `git status --short`：确认除当前 task artifacts 外无不相关改动。
2. `git rev-parse HEAD`：记录 baseline commit。
3. 创建本地备份 ref，例如：`git branch backup/<child-slug>-pre-split HEAD`。
4. 若进入多 seam 实现且用户未授权提交，则每个 seam 之后生成 patch 检查点：`git diff --binary > .trellis/tasks/<child>/rollback/<step>.patch`。

回滚层级：

- 单文件误改：`git restore -- <path>`。
- 当前 seam 回滚：`git apply -R .trellis/tasks/<child>/rollback/<step>.patch`。
- 整个 child 回滚：回到 `backup/<child-slug>-pre-split` 对应状态； destructive reset 必须先向用户确认。
- 已提交 child 回滚：优先 `git revert <commit>`，不手工反删大段代码。

备份文件/patch 属于 task planning / safety artifacts；最终归档前检查不得把临时 rollback patch 当作产品代码依赖。

## Compatibility Notes

- 不改 Dexie schema；若任何子任务意外需要 schema 变更，停止并另开任务。
- 不改 `@tsian/contracts` contract shape；若需要，停止并补 `npm run build:contracts` 规划。
- 不改变 default workspace seed 内容；如拆分导致文本变化，需要明确 diff 并单独确认。
- 不改变 native/text tool-call protocol 行为；AI runtime 拆分必须保持 provider output 兼容。
