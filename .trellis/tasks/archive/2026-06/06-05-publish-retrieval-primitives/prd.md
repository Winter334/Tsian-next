# brainstorm: 发布检索基础节点

## Goal

将上一阶段拆出的默认 AIRP 检索内部阶段，推进为一组足够通用、可测试、可在工作流图中声明的基础节点。下一阶段的目标不是一次性覆盖所有检索场景，而是发布一小组稳定的数据流/记录处理节点，让玩家和模组开发者能够开始表达常见的记忆检索、筛选、合并与上下文组合逻辑，同时避免把 AIRP 当前 event/archive 结构误发布成通用记忆模型。

## What I Already Know

* 项目总目标是让 AIRP 核心信息处理流逐步被工作流系统覆盖，减少平台 host 和记忆系统中的硬编码。
* 用户倾向将 AIRP 当前结构视作一个内置 preset，而不是所有玩家/模组必须采用的记忆模型。
* 用户倾向先做通用基础节点，不把节点语义绑定到 AIRP 的事件/档案结构。
* 用户认为 `compute` 是合法且必要的基础节点；特殊、不泛用、难以抽象成稳定基础节点的逻辑可以依靠 `compute`，官方默认记忆方案作为示例 preset 也可以在合适环节使用 `compute`。
* 真正需要提防的是滥用 `compute`：把明明泛用、可复用、可配置的常见检索行为长期藏在脚本里。
* 上一阶段已经将 `assembleRetrievalContext()` 内部分解成 `query / extraction / relation / ranking / semantic / merge / compose` 阶段。
* 当前公共默认工作流仍使用高层 `memory-query { source: "event-archive" }`。
* `memory-query { source: "collection" }` 已经能读取自定义 save-scoped memory records，并输出 `records` / `count`。
* `template-compose` 已经能把输入数据组合成文本或 JSON，可作为上下文组合的已有基础节点。
* 发布新节点会涉及 `packages/contracts/src/workflow.ts`、`packages/workflow-engine/src/validator.ts`、`apps/platform-web/src/workflow-host/index.ts`、executor、编辑器 registry 和端口 schema。

## Assumptions (Temporary)

* 下一阶段应该发布“少量可运行的通用节点”，而不是只继续内部重构。
* 默认 AIRP `event-archive` 路径保留为兼容高层节点；本任务已选择直接用混合 AIRP workflow preset 替换默认入口。
* 语义检索仍保持为受控内部阶段，暂不作为第一批公共基础节点。
* 第一批节点应能服务于 keyword -> snippet/summary、topic -> note、relationship -> fact 等非 AIRP 记忆结构。

## Open Questions

* None pending final confirmation.

## Requirements (Evolving)

* 新节点命名和 config 语义应保持通用，以 record/item/data/text/path/predicate/score/merge/template 等概念为主。
* 新节点应能直接用于 `memory-query { source: "collection" }` 输出的 `records`。
* 新节点应避免为了替代 `compute` 而引入过度复杂的表达式语言；原型期优先采用有限、可校验的配置结构。
* 新节点必须进入合约类型、workflow-engine 加载期校验、platform-web executor 注册和编辑器展示。
* 新节点应有明确输入、输出、失败行为和静态/单元测试保护。
* AIRP 默认检索应由混合 workflow preset 直接替换当前高层 `memory-query { source: "event-archive" }` 路径。
* 替换默认工作流时，不要求逐行复刻旧实现，也不要求 prompt/debug 文本完全一致；核心要求是复刻现有记忆系统的功能逻辑和记忆原理。
* “记忆原理”包括默认记忆处理、存储和检索：从对话中抽取/维护记忆，写入权威 memory records，并在下一轮基于当前输入、近期上下文、事件/档案/关系信号检索出可用于生成的上下文。
* 下游 chat / maintenance / memory-write 链路必须保持可运行；如果节点拆分或 prompt 结构变化，需要确保上述记忆处理、存储、检索闭环仍成立。
* 本任务实现范围以默认检索链替换为主；默认记忆处理/存储链沿用现有 `maintenance ai-call -> memory-write`，但验收必须覆盖完整记忆闭环。
* 第一批公共节点选定为 `record-filter`、`record-merge`、`record-format`。
* `record-filter` 应过滤输入记录数组，支持基于 record meta、tags 和 `data` 字段路径的有限谓词。
* `record-merge` 应合并多个记录/对象数组，并按稳定 key 去重，保留可预期顺序。
* `record-format` 应将记录/对象数组格式化为文本，支持每项模板和分隔符，用于构造 prompt/context 片段。
* `record-rank`、通用 relation traversal、语义检索节点暂不在第一批发布；默认 AIRP 特有排名/关系胶水可先放在 `compute`。
* 节点发布判断应区分“值得沉淀的泛用行为”和“适合留给 `compute` 的特殊行为”。

## Acceptance Criteria (Evolving)

* [x] 选定 MVP 方向：通用节点 + 官方默认检索混合 preset，允许特殊环节使用 `compute`。
* [x] 选定第一批公共检索/记录基础节点：`record-filter`、`record-merge`、`record-format`。
* [x] 每个节点都有通用 config 合同、executor、端口展示和失败行为。
* [x] 新节点能与 `memory-query { source: "collection" }` 和 `template-compose` 串成可用自定义检索链。
* [x] 默认工作流使用 AIRP collection queries、第一批记录节点和 `compute` 组成混合检索 preset，替换高层 `memory-query { source: "event-archive" }` 默认检索路径。
* [x] 混合官方检索 preset 的替换/并行策略被明确记录：直接替换默认工作流。
* [x] 默认工作流替换兼容标准被明确记录：复刻现有记忆系统的功能逻辑/记忆原理，允许具体实现调整。
* [x] 默认 AIRP 检索替换后的运行链路通过回归验证；行为漂移如果发生，必须不破坏默认记忆处理、存储、检索闭环。
* [x] 实现范围被明确记录：检索替换为主，处理/存储链沿用现有节点但纳入闭环验收。
* [x] 相关 builds/tests 通过。
* [x] 规范记录新节点的定位、边界和后续 AIRP preset 展开策略。

## Definition Of Done

* Tests added/updated where behavior changes.
* `npm run build:contracts` if workflow contracts change.
* `npm run build:workflow-engine` and workflow-engine tests for node validation/static proofs.
* `npm run build:web` for platform-web changes.
* Specs/docs updated for any new public workflow node convention.

## Candidate MVP Approaches

### Approach A: Narrow Generic Record-Processing Nodes (Recommended)

发布一小组通用记录处理节点，例如 `record-filter`、`record-rank`、`record-merge`，复用已有 `memory-query { source: "collection" }` 作为记录来源，复用 `template-compose` 作为上下文组合。默认 AIRP event/archive 检索暂不完全展开，只记录其内部阶段未来如何映射到这些节点。

**Pros**

* 能最快让玩家/模组开始用基础节点表达常见检索链，同时仍允许特殊环节使用 `compute`。
* 避免把 AIRP 当前 event/archive 结构固化为通用节点模型。
* 合约、executor、编辑器、测试的新增面可控。
* 和上一阶段的“结构检索优先、语义检索延后”一致。

**Cons**

* 默认 AIRP 检索图仍不会在本任务完全显式化。
* 第一批节点只能覆盖通用记录链，不会覆盖全部 AIRP 内部关系/排名细节。

### Approach B: Publish Full Retrieval Stage Vocabulary

一次发布 query/extract/filter/relate/rank/merge/compose 等完整阶段节点，并开始把默认 AIRP 检索映射到它们。

**Pros**

* 离最终可编辑默认检索图更近。
* 能更快验证 AIRP 默认 preset 的完整工作流表达。

**Cons**

* 合约和 editor surface 膨胀较快。
* 容易在通用语义未稳定前，把 AIRP 特有结构混进公共节点。
* 行为漂移风险更大。

### Approach C: Node Publication Infrastructure First

先做节点元数据/注册/实验节点机制，允许未来更快发布节点，但本任务不重点做新的检索节点能力。

**Pros**

* 有利于后续扩展和实验节点治理。
* 能降低未来每次加节点的重复成本。

**Cons**

* 对用户当前目标的体感推进较弱。
* 不能解决常见检索逻辑仍依赖黑盒或滥用 `compute` 的问题。

### Approach D: Hybrid Official Retrieval Preset + Generic Nodes (Selected)

发布少量明显泛用的记录处理节点，同时把默认 AIRP 检索的一部分改造成更显式的工作流 preset。通用环节使用公共节点，AIRP 特有的提取、弱关系、排名胶水、上下文微调等暂时使用 `compute`，直到这些行为被证明值得沉淀为更稳定的基础节点。

**Pros**

* 更快推进“默认 AIRP 核心信息处理流被工作流覆盖”的总目标。
* 官方默认记忆方案可以成为真实示例，展示基础节点和 `compute` 如何配合。
* 避免过早发布 AIRP-specific 节点，又不会让默认检索继续长期隐藏在一个黑盒节点里。
* 能通过实际 preset 观察哪些 `compute` 逻辑会重复出现，从而更有根据地提炼下一批基础节点。

**Cons**

* 如果缺少边界和测试，`compute` 脚本可能变成新的黑盒。
* 当前 `compute` 只接收 `inputs` 和 `macros`，不能访问 platform context、runtimeEngine 或 signal；因此上游节点必须显式提供 records、query、messages 等数据。
* 需要更认真地设计 preset 内节点拆分和端口命名，否则会把复杂度转移到图结构里。

## Decision (ADR-lite)

**Context**: 完全避免 `compute` 会让工作流系统失去表达特殊逻辑的弹性；但完全依赖 `compute` 又会让通用检索能力长期停留在不可配置脚本里。AIRP 默认记忆方案本身可以作为官方示例 preset，展示基础节点和 `compute` 如何协作。

**Decision**: 下一阶段采用 Approach D：发布少量通用检索/记录基础节点，同时开始构建官方 AIRP 检索的混合 workflow preset。泛用环节优先使用公共节点，AIRP 特有或暂时不值得公共化的逻辑允许使用 `compute`。该混合 preset 将直接替换当前默认工作流中的高层 `memory-query { source: "event-archive" }` 默认检索路径，而不是作为并行实验 preset 存在。

**Consequences**: 这能更快推进 AIRP 核心信息处理流被工作流覆盖，也能通过真实 preset 观察哪些 `compute` 脚本值得继续沉淀成基础节点。风险是 `compute` 可能形成新的黑盒，并且直接替换默认检索会带来行为漂移风险，因此本任务需要明确使用边界、输入/输出、端口命名和测试保护。

## Compatibility Decision: Memory Principle Parity

**Context**: 默认工作流替换不需要旧实现的逐行兼容，也不需要 prompt、debug 或排序细节完全一致。真正重要的是现有默认记忆系统的功能逻辑仍被复刻：记忆如何被处理、如何被存储、如何被检索并注入生成链路。

**Decision**: 本任务采用“记忆原理兼容”作为默认工作流替换标准。实现可以调整，节点可以重新拆分，部分特殊逻辑可以使用 `compute`，但默认记忆处理、存储、检索闭环必须成立。

**Consequences**: 测试和验收应重点证明默认工作流仍能从对话生成记忆写入、将写入落到权威 `memoryRecords`，并在后续回合检索相关上下文供 chat/maintenance 使用。旧实现的字面 prompt 或 debug 结构不是硬性标准，除非某些输出仍被下游节点依赖。

## Scope Decision: Retrieval Replacement With Loop Acceptance

**Context**: 默认记忆系统包含处理、存储和检索三个环节。上一阶段已经让默认 maintenance 输出通过显式 `memory-write` 写入权威 `memoryRecords`，因此本阶段不必同步重做处理/存储链。

**Decision**: 本任务以默认检索链替换为主要实现范围：将高层 `memory-query { source: "event-archive" }` 默认检索路径替换为混合 workflow preset。默认记忆处理/存储继续沿用现有 `maintenance ai-call -> memory-write`，但作为完整记忆闭环的一部分进行验收。

**Consequences**: 任务范围保持可控，同时不会把默认记忆系统割裂成“只替换检索”的局部成功。验收应覆盖至少一次写入和后续检索，证明处理、存储、检索三段仍协同工作。

## Compute Boundary Decision (Draft)

**Context**: `compute` 本身是工作流系统的重要能力。它允许官方 preset、玩家和模组作者表达特殊逻辑、过渡逻辑、实验逻辑，或者那些暂时不值得沉淀成公共节点的处理流程。完全回避 `compute` 会让工作流系统变僵硬。

**Decision**: 下一阶段不以“消灭 `compute`”为目标，而是建立节点沉淀边界：当某类行为具有通用输入/输出、稳定配置方式、可测试失败行为，并且会在多个记忆结构或工作流中重复出现时，应优先发布为基础节点；当逻辑高度场景化、配置结构会变得像一门小语言、或只服务于官方 preset 的少数特殊环节时，可以保留为 `compute`。

**Consequences**: 官方默认记忆方案可以混合使用基础节点和 `compute`，这不会削弱其示例价值。后续判断重点从“是否用了 `compute`”转向“是否把可沉淀的通用能力滥留在 `compute` 里”。

## Technical Notes

* AIRP authoritative memory records use namespace `airp` and collections `events`, `archives`, and `globals`.
* `memory-query { source: "collection" }` currently lists save-scoped `memoryRecords` by optional `namespace`, `collection`, substring `query`, and `limit`, sorted by `updatedAt` descending.
* The default AIRP schema defines event fields `time`, `status`, `entityTags`, `entityArchiveIds`, and `content`; archive fields `type`, `name`, `aliases`, `background`, `situation`, `focus`, `linkedNames`, `linkedArchiveIds`, and `presence`; global records use `key` and `value`.
* Current default retrieval stages perform direct archive selection, present archive selection, catalog event selection, weak relation selection, event graph ranking, event chain selection, semantic retrieval, merge/dedupe, hint entity computation, prompt assembly, and debug assembly.
* For default workflow replacement, the likely graph shape is multiple collection queries for AIRP records, generic record-processing nodes for common operations, and `compute` for AIRP-specific extraction/ranking/relation glue that is not yet ready to become a public primitive.
* Current default workflow: `apps/platform-web/src/workflow-host/default-workflow.ts`.
* Current memory-query executor: `apps/platform-web/src/workflow-host/executors/memory-query.ts`.
* Current retrieval implementation: `apps/platform-web/src/runtime-host/retrieval.ts`.
* Workflow contracts: `packages/contracts/src/workflow.ts`.
* Workflow validator known node types: `packages/workflow-engine/src/validator.ts`.
* Platform executor registry: `apps/platform-web/src/workflow-host/index.ts`.
* Editor node registry/schema: `apps/platform-web/src/components/workflow/node-registry.ts`, `apps/platform-web/src/components/workflow/node-schema.ts`.
* Editor default node config: `apps/platform-web/src/composables/useWorkflowEditor.ts`.
* Compute executor: `apps/platform-web/src/workflow-host/executors/compute.ts`; scripts only receive `inputs` and `macros`, not platform context.
* Relevant spec: `.trellis/spec/platform-web/frontend/state-management.md`.
* Previous task: `.trellis/tasks/archive/2026-06/06-05-airp-retrieval-workflow-boundary/prd.md`.

## Candidate First Public Node Sets

### Node Set A: Minimal Common Record Chain (Selected)

Add `record-filter`, `record-merge`, and `record-format` while reusing existing `memory-query { source: "collection" }` as the record source and `compute` for AIRP-specific ranking/relation logic.

**Why this set**: filtering, dedupe/merge, and list-to-text formatting are common across many memory structures and do not require a broad scoring language. Ranking and relation traversal can remain in `compute` until their generic semantics are clearer.

## Node Set Decision

**Context**: The default AIRP retrieval path needs filtering, merging, formatting, ranking, relation selection, and composition. Ranking and relation traversal are important but their generic public semantics are still less clear than basic record operations.

**Decision**: Publish `record-filter`, `record-merge`, and `record-format` as the first public record-processing nodes. Reuse `memory-query { source: "collection" }` for record source queries. Keep AIRP-specific ranking/relation glue in `compute` for this task.

**Consequences**: This gives custom memory workflows useful non-`compute` building blocks immediately, while avoiding premature `record-rank` config design. The default AIRP mixed preset will still contain meaningful `compute`, but those scripts should be bounded to AIRP-specific logic and covered by tests/static proof.

## Implementation Plan

* PR1: Add workflow contract entries, validator known types, platform executors, editor registry entries, default configs, and port schemas for `record-filter`, `record-merge`, and `record-format`.
* PR2: Replace the default high-level `memory-query { source: "event-archive" }` retrieval node with a mixed AIRP retrieval graph that queries `airp/events`, `airp/archives`, and `airp/globals`, uses public record nodes for generic steps, and uses bounded `compute` for AIRP-specific selection/ranking/assembly.
* PR3: Add tests/static proofs for node contracts, executor behavior, default workflow shape, and the memory processing/storage/retrieval loop acceptance criteria.
* PR4: Update specs to document the public node set, `compute` boundary, and AIRP default preset replacement rule.

### Node Set B: Add Generic Ranking Now

Add `record-filter`, `record-rank`, `record-merge`, and `record-format`.

**Why this set**: ranking is central to retrieval and would reduce `compute` usage sooner. The risk is designing a premature scoring config that either becomes too weak for AIRP or too complex for a first public node.

### Node Set C: Compute-First Default Replacement

Do not publish new record-processing nodes in this task. Replace default retrieval with explicit AIRP collection queries plus one or more `compute` nodes, then extract public nodes later.

**Why this set**: fastest path to workflow coverage of the default memory principle. The risk is that the official preset becomes a new script-heavy black box and delays base-node vocabulary discovery.
