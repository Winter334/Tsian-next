# 优化工作流编辑器易用性与校验体验

## Goal

让当前工作流编辑器从“工程向 DAG 配置工具”进一步收敛为“高级作者可可靠编辑、普通玩家不容易被英文字段和隐藏操作吓退”的工作流预设编辑体验。重点修复已经发现的可用性硬伤、保存链路不清晰、校验不足和表单过度工程化问题，同时不改变工作流系统的运行时边界。

## What I already know

* 用户认可当前评审结论：除首次启动遮罩外，其它问题基本成立。
* 首次启动遮罩是有意的氛围设计，本任务不处理。
* 当前工作流编辑器已经支持节点画布、节点表单、Raw 编辑、导入导出、自动布局、诊断栏、状态契约面板。
* 当前运行时内置节点类型包括 `ai-call`、`result`、`switch`、`compute`、`state-query`、`state-write`、`template-compose`、`record-filter`、`record-merge`、`record-format`。
* 当前默认 AIRP 工作流能完整显示 14 个节点 / 24 条边，但关键检索策略仍由较长 `compute` 脚本承载。
* 当前资源库全屏编辑器提示“保存仍使用页面右上角保存资源”，但工作流画布工具栏也有“保存工作流”按钮，保存语义容易混淆。
* 当前新增节点入口主要依赖画布右键菜单，不够可发现，也不适合触屏或新手。
* 当前窄屏下工具栏会溢出，按钮文字会被压缩成窄列。
* 当前节点表单仍大量暴露英文/工程字段，如 `varName`、`namespace`、`collection`、`outputName`、`inputVarName`、`Raw` 等。

## Requirements

* 工作流编辑器应提供可发现的添加节点入口，不只依赖右键画布。
* 工作流编辑器应改善保存入口和保存状态，让用户知道全屏编辑器里的操作是否已经应用到资源草稿，以及如何最终保存资源。
* 工作流编辑器的校验应覆盖更多运行时会失败的常见配置问题：
  * 节点必填 config 缺失或为空。
  * `ai-call` 引用的 prompt preset 不存在时给出可理解提示。
  * `state-query` 缺少 namespace / collection 时给出可理解提示。
  * 边连接到不存在的输出端口或输入槽时给出可理解提示。
  * 常见节点的输入变量名与边注入变量名明显不匹配时给出提示。
* 工作流编辑器应减少半中文半英文的夹生感：
  * 常规表单主标签使用中文，不把英文技术名混在主标签里。
  * 必要的技术标识、变量名、端口名和配置键仍完整保留，作为值、占位、辅助说明或高级编辑内容出现。
  * Raw JSON、脚本、命名空间、集合、变量名等高级能力是必要能力，不隐藏、不弱化；普通玩家不理解时可以不碰它们。
  * 如果某些高级编辑器短期内很难优雅中文化，可以先保持原能力稳定，不为了文案改造破坏高级编辑。
* 边编辑应尽量从目标节点输入槽中选择变量名，而不是只让用户手输 `varName`。
* 窄屏或较小窗口下工具栏应可用，不应让按钮跑出可视区域或文字挤压变形。
* 现有高级能力不应被移除：Raw 编辑、导入导出、compute 脚本、状态契约编辑仍应保留。

## Acceptance Criteria

* [x] 在资源库工作流预设全屏编辑器中，可以通过可见按钮打开添加节点菜单并新增节点。
* [x] 工作流全屏编辑器的保存入口不再造成“点了保存但没有资源落库”的混淆。
* [x] 新建一个空 `state-query` 节点时，诊断能提示缺少 namespace / collection，而不是只显示工作流结构通过。
* [x] `ai-call` 选择或输入不存在的 prompt preset 时，诊断能提示引用不存在。
* [x] 边编辑器可以选择目标节点的输入槽；需要手输时仍允许高级输入。
* [x] 390px 左右窄屏下，工具栏操作仍可访问，按钮文字不明显挤压。
* [x] 常规工作流节点表单的主要字段中文化，不出现主标签半英文半中文；高级编辑能力仍可直接使用。
* [x] 首次启动遮罩保持现状。
* [x] `npm run build:web` 通过。

## Definition of Done

* 相关 Vue 组件、composable 和校验逻辑更新完成。
* 高风险交互（保存、清空、Raw、脚本）有清晰状态或文案区分。
* 现有工作流预设仍可加载、预览、编辑和导出。
* 必要时补充小范围测试或至少通过构建验证。
* 不改变 workflow runtime executor 的安全边界。

## Out of Scope

* 不修改首次启动遮罩和氛围化启动流程。
* 不在本任务实现 block/subworkflow/system package。
* 不重写默认 AIRP 检索策略为全节点化模型。
* 不移除、不隐藏 Raw JSON、compute 脚本、命名空间、集合、变量名、导入导出等高级能力。
* 不强行全面改造复杂高级编辑器；若改造风险高，先保持功能可用与稳定。
* 不引入新的大型图编辑框架。

## Decision (ADR-lite)

**Context**: 当前编辑器功能基本覆盖高级工作流编辑，但界面文案大量混用英文技术字段，普通作者和玩家会感到工程化、难以接近。与此同时，Raw、脚本、命名空间、集合、变量名等高级能力对系统作者是必要的，不能因为降低门槛而移除。

**Decision**: 采用“作者友好 MVP”。常规表单主标签中文化，避免半中文半英文；高级技术标识保留在值、说明或高级编辑内容中。高级能力不隐藏、不削弱，优先保证稳定可用。

**Consequences**: 本任务能较快改善主要体验硬伤，同时不扩大到重做高级编辑器或默认工作流结构。后续若要做更玩家化的引导模式，可以在当前编辑器之上增加可选简化视图。

## Technical Notes

* 工作流编辑器主组件：`apps/platform-web/src/components/workflow/WorkflowEditorCanvas.vue`
* 工具栏：`apps/platform-web/src/components/workflow/EditorToolbar.vue`
* 节点弹窗与表单：`apps/platform-web/src/components/workflow/WorkflowNodeEditorDialog.vue`、`apps/platform-web/src/components/workflow/NodeInspector.vue`、`apps/platform-web/src/components/workflow/inspector/*`
* 边弹窗：`apps/platform-web/src/components/workflow/WorkflowEdgeEditorDialog.vue`
* 编辑器状态转换：`apps/platform-web/src/composables/useWorkflowEditor.ts`
* 节点端口推导：`apps/platform-web/src/components/workflow/node-schema.ts`
* 状态契约分析：`apps/platform-web/src/components/workflow/state-contract.ts`
* 运行时 executor 注册：`apps/platform-web/src/workflow-host/index.ts`
* 工作流结构校验器：`packages/workflow-engine/src/validator.ts`
* 资源库全屏编辑入口：`apps/platform-web/src/views/ResourceLibraryView.vue`
* 平台方向文档要求继续保持 workflow-as-system 边界：工作流可配置、可调试、可追踪，但不直接绕过平台能力。

## Open Questions

* 无。用户已确认按“作者友好 MVP + 高级能力保留”进入实现。
