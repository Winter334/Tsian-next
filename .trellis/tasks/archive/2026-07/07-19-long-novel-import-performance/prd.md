# 长篇小说导入性能优化

## Goal

让开局向导可以导入 5000 章 / 2000 万字级别的长篇小说，而不会因为按章节串行写入和全量渲染导致等待时间过长或界面卡顿。优化后，用户仍按“导入小说 → 确认章节 → 开始开局建模/游玩”的现有流程使用；Agent 和前端仍以“章节”为读取语义。

## Background / Confirmed Facts

- 当前真实触发样本约为 2100 章 / 800 万字；目标容量按 5000 章 / 2000 万字设计，以覆盖大部分长篇小说。
- 当前无需处理“正式游玩后重新导入覆盖旧 source”的冲突：正式游玩界面没有重新导入入口，重新导入只发生在开局向导阶段。
- 当前 `writeCorpus()` 对每个章节执行一次 `await tsian.workspace.write(ch.path, ch.content)`，且串行等待；几千章会变成几千次 bridge RPC 和存储写入。证据：`apps/play-frontend-dev/src/composables/useSetupState.ts:186`。
- 当前 `buildSourceCorpus()` 会为每章生成完整 `content` 并保存在 `chapters` 数组中，长篇导入时会产生较高内存复制和 GC 压力。证据：`apps/play-frontend-dev/src/lib/source.ts:387`。
- 当前章节索引类型只描述每章 `title/path/characters`，读取者默认 `chapter.path` 指向单章文件。证据：`apps/play-frontend-dev/src/lib/source.ts:47`。
- 前端预览当前只接收 path 并直接 `workspace.read(path)`。证据：`apps/play-frontend-dev/src/composables/useSetupState.ts:340`。
- 开局建模 prompt 要求 Agent 通过 `inspect_source_opening` / `read_opening_slice` 读取源文本。证据：`apps/play-frontend-dev/src/lib/source.ts:462`。
- 平台内置 workspace template 的 opening/common `loadSource()` 也假设 chapter index 中每章有 `path`。证据：`apps/platform-web/src/storage/workspace-templates/scripts/opening.ts:15`。
- frontier 推进当前按章节窗口读取，窗口最多 15 章，每章读一次 `chapter.path`。证据：`apps/platform-web/src/storage/workspace-templates/scripts/frontier.ts:26`。
- 确认页当前对 `chapters` 全量 `v-for` 渲染按钮，并对所有 `.chapter-card` 做 GSAP stagger 动画。证据：`apps/play-frontend-dev/src/components/setup/step1/SplitReview.vue:94`、`apps/play-frontend-dev/src/components/setup/step1/SplitReview.vue:65`。
- Bridge SDK 目前只暴露单文件 `workspace.write(path, content)`，没有批量写入 API。证据：`packages/play-bridge/src/tsian-api.ts:163`。
- 平台 bridge/contract 也只定义 `workspace.write` 单文件方法。证据：`packages/contracts/src/bridge.ts:66`、`apps/platform-web/src/bridge/remote-iframe-bridge.ts:633`。

## Requirements

- R1. 长篇导入必须显著减少写入操作数量，避免“章节数 = workspace.write 次数”的导入模型。
- R2. 前端、开局建模脚本、frontier 推进脚本必须继续支持“按章节读取”的语义，不能要求 Agent 或玩家理解底层存储分片。
- R3. 新导入统一使用新的分片格式；当前处于 alpha 测试阶段，不要求迁移已有旧导入源。已有旧格式用户通常已经进入正式游玩界面，本任务不以“让旧格式继续停留/恢复在开局向导”为目标，但正式游玩阶段的运行期 source 读取应继续兼容旧格式，避免 frontier 推进等后续流程破坏已有存档。
- R4. 新格式应适合连续阅读窗口：读取相邻章节时应能复用同一个底层文本分片，避免每章一次读取。
- R5. 导入确认页必须避免一次性渲染和动画几千个章节卡片导致的 UI 卡顿。
- R6. 导入过程应提供进度状态，至少能区分分章、构建分片、写入源文本、写入索引/manifest 阶段，并在长耗时阶段避免界面呈现为静默卡死。
- R7. 不为了本任务改变玩家开局流程、Agent 开局建模职责或 workspace checkpoint 语义。
- R8. 目标规模下的纯文本处理（规范化、章节检测、分片构建）应放到 Web Worker 中执行，避免主线程长时间无响应；workspace 写入仍由主线程通过现有 bridge 完成。

## Acceptance Criteria

- [ ] AC1. 新导入的长篇小说不会为每章写一个 `save/source/chapters/*.md` 文件；写入次数应与分片数相关，而不是与章节数线性一致。
- [ ] AC2. `chapters.index.json` 能表达新的分片格式；运行期 source reader 能同时读取旧的 `chapter.path` 单章文件格式和新的 shard 格式，但本任务不要求自动迁移已有旧导入源。
- [ ] AC3. 前端章节预览可读取新格式章节，显示内容与原章节一致或仅做原有预览截断。
- [ ] AC4. 开局建模读取脚本可读取新格式章节；Agent prompt 中仍使用现有“读源文本/读开头切片”的语义。
- [ ] AC5. frontier 推进可读取新格式章节窗口，并保持窗口大小、字符上限和 source anchor 行为不变。
- [ ] AC6. 确认页在几千章索引下不会全量创建几千个带动画的章节按钮；首屏和滚动交互保持可用。
- [ ] AC7. 本任务不要求旧的单章文件导入源在开局向导中继续可用或被自动迁移；旧格式用户已进入正式游玩界面的存档，应在后续 source 读取/frontier 推进中保持可用。
- [ ] AC8. 目标规模文本的规范化、章节检测和分片构建不在主线程同步执行；导入 UI 在处理期间保持可渲染阶段/进度状态。
- [ ] AC9. 相关构建检查通过：涉及 platform-web/contracts 时运行 `npm run build:web`，若编辑 contracts 则运行 `npm run build:contracts`。

## Out of Scope

- 不在本任务中重构整个 workspace bridge 为批量写入 API，除非设计阶段发现分片模型无法满足目标。
- 不提供旧的单章文件导入源自动迁移。
- 不为旧格式回到开局向导提供专门恢复/迁移 UI；旧格式兼容仅限正式游玩阶段的运行期 source reader 继续读取 `chapter.path` 单章文件。
- 不新增 source 文件清理/删除能力；重导入只在开局向导阶段发生，以新索引覆盖读取入口即可。
- 不改变 Agent 对“章节”的业务语义。
- 不改变小说内容提取、角色选择、游玩设定对话或开局叙事生成规则。

## Decisions

- D1. alpha 阶段不迁移旧导入源，也不支持旧格式回到开局向导；已有旧格式通常已在正式游玩界面，运行期 source reader 保留旧 `chapter.path` 读取兼容，避免破坏 frontier 推进等后续流程。
- D2. 新导入采用约 1MB 文本内容分片，并尽量在章节边界切分；单章超过目标大小时允许单章独占一个 shard。
- D3. 分章与分片构建纳入 Web Worker 范围；Worker 只负责纯文本处理和返回待写入 shard/index/manifest，主线程负责 workspace 写入。
- D4. 不把旧 source 文件清理/删除能力纳入本任务；正式游玩后没有重新导入入口，开局向导阶段重导入以新索引覆盖读取入口即可。
