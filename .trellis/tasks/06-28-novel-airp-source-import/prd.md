# 小说 AIRP 整本导入与 source normalization

Parent: `06-27-default-card-novel-reader-airp`

## Goal

让默认小说 AIRP 保存实例支持把一本或一段文本小说导入当前 save workspace，并把原始输入规范化为稳定、可引用、可渐进处理的 source corpus。该任务只实现开局向导的第一步：导入小说并生成 source 文件与索引；不做整本语义抽取、角色初始化、schema 生成、开局组装或完整阅读器 UI。

## User Value

- 玩家可以从一本小说开始创建 AIRP 存档，而不是手工搭世界观。
- 小说原文成为当前 save 的事实来源，后续 Agent / Skill 可按稳定路径回溯依据。
- 后续“初始抽取窗口”“architect”“玩家设置流程”有稳定输入，不需要各自重新解析玩家上传的文本。
- 长篇小说可以先被整理为章节级 source units，再由后续 Agent 判断读取多少内容足以搭建开局。

## Product Decisions

- 平台负责存档管理，默认游戏卡内不再做“新游戏 / 继续游戏”；游戏卡前端只服务当前 save。
- 首屏长期方向是开局动画；本任务暂不实现动画，但 UI 结构应预留从首屏过渡到开局向导的空间。
- 当前 save 首次启动且没有 ready source manifest 时，进入开局向导第一步：导入小说。
- 导入方式分为粘贴文本和文件导入：粘贴面向短篇、片段、小体量文本；文件导入面向几十万、百万字甚至千万字长篇。
- Manifest 记录导入意图：粘贴文本写 `importMode: "paste"`、`recommendedExtractionMode: "full"`；文件导入写 `importMode: "file"`、`recommendedExtractionMode: "frontier"`。
- 导入完成后不提供普通玩家可用的重复导入入口；不满意应通过平台新建存档重新开始。
- 当前任务导入成功后只显示下一步开局向导/初始化流程占位，不实现完整开局对话。

## Source Processing Decisions

- 导入阶段做保守 normalization + 章节级切分，不做语义清洗、摘要、翻译、角色/事件抽取。
- 广告、作者话、站点信息等不由导入脚本强删；后续抽取 Skill/Agent 可在理解 source 时过滤。
- 有清晰章节时按真实章节切分；无章节或章节不清晰时按接近章节的粒度生成 pseudo chapters。
- Pseudo chapter 目标粒度约 15k 中文字符，优先在段落边界切分，单段过长时才硬切。
- 章节文件路径使用稳定序号，不使用章节标题作为主文件名：`chapter-0001.md` / `pseudo-chapter-0001.md`。
- 检测到的章节标题写入 `chapters.index.json` 的 `chapters[].title`，并可作为章节文件内的 Markdown 标题。
- 样例 `情花孽.txt` 中 `第一章 逍遥海岸飞星落`、`第二章 仙人授书同岛住`、`第三章` 都应识别为有效章节边界；`第三章` 虽无副标题，title 可直接记录为 `第三章`。
- 导入阶段不默认写大量物理 chunk 文件，也不默认额外保存一份完整 `normalized.md`，避免长篇小说在 workspace 中重复占用空间。

## Chapter Detection Strategy

- `strong`：常见章节标记可直接采用，例如 `第一章`、`第1章`、`第十二回`、`第三章`、`Chapter 1`、Markdown 标题。
- `medium`：序章/楔子/番外/后记/卷标等独立短行可采用，但应避免像正文 prose 的行。
- `weak`：`1. xxx`、`01 xxx`、`001、xxx` 等数字目录式标题，必须多个候选构成连续递增且间距像章节，才可采用。
- 候选章节行应尽量是独立短行，处在段落边界；除 strong 规则外，应避免把以 `。`、`？`、`！` 或对话引号收尾的正文短句识别为章节。
- 若检测结果太少、太密、间距异常，或多数章节过短，应回退到 pseudo chapter。

## Index Artifacts

Source 索引采用两层结构：小 manifest + 极简章节目录。

```text
save/source/
  manifest.json
  chapters.index.json
  chapters/
    chapter-0001.md
    chapter-0002.md
    pseudo-chapter-0001.md
```

`save/source/manifest.json` 只放全书级摘要和索引文件路径，不内联完整章节列表。至少包含：

- `version`
- `status`
- `title`
- `sourceFormat`
- `importMode`
- `recommendedExtractionMode`
- `chapterDetection`
- `chapterDetectionConfidence`
- `importedAt`
- `normalizationVersion`
- `totalCharacters`
- `chapterCount`
- `files.chaptersIndex`
- `files.chaptersRoot`
- `originalFileName`（文件导入时记录文件名，不记录本地绝对路径）

`save/source/chapters.index.json` 是极简目录：

```json
{
  "version": 1,
  "chapters": [
    {
      "title": "第一章 风起",
      "path": "save/source/chapters/chapter-0001.md"
    }
  ]
}
```

数组顺序就是章节顺序。v0 不默认添加 `id`、`index`、`kind`、`characterCount`。后续 entity 的 `sourceRefs` 可直接引用章节路径；更精确证据以后再加 `evidence`，不替换 `sourceRefs`。

## Agent / Skill Direction

推荐小说 AIRP v0 阵容为 `master` / `architect` / `lorekeeper` / `post-processing`，并采用“少 Agent，多 Skill 扩展”。本任务只记录方向，不实现 Agent 改造。

- `master`：正式游玩时唯一玩家直面 Agent，负责最终叙事和选项。
- `architect`：前端可直接调用的开局向导、世界构建、schema/director brief 维护入口。
- `lorekeeper`：source/canon/剧透安全资料员，读取 manifest、章节目录、章节文本、entities、schema，返回简洁事实材料，不负责剧情节奏。
- `post-processing`：回合后维护 runtime/entity/frontier/branch，检测 schema/source/brief 是否 stale，必要时 call `architect` 或 `lorekeeper`。
- `director` 暂不做常驻 Agent；导演能力先作为 `architect` 可加载的 director-brief Skill。

## Opening Setup Direction

后续开局过程采用“向导式 UI + architect 对话”的混合形态：

- UI 负责结构性步骤：导入、原著/原创、游玩倾向、候选卡片确认、步骤切换。
- `architect` 负责开放性对话：原创角色背景、金手指、和原著关系、开局偏好。
- 对话过程优先写 draft，例如 `save/setup/session.json`、`save/setup/player-draft.json`。
- 玩家确认后再写正式文件，例如 `save/playthrough/player.json`、`save/playthrough/mode.json`、player entity、`save/director/current-brief.md`。
- 当前任务只在导入完成后展示“下一步：开局向导/初始化流程”的占位，不实现完整对话和落盘流程。

## Confirmed Facts

- 前序子任务 `06-27-novel-airp-workspace-schema-guide` 已完成并归档；默认 workspace 模板已包含 `save/source/README.md`、`save/source/manifest.json`、`save/schema/`、`save/entities/`、`save/playthrough/`、`save/director/` 等文件。
- 项目级方向文档 `docs/active/novel-airp-workspace-schema-direction.md` 定义 `save/source/` 为 source corpus 根目录，原方向允许 manifest、normalized/novel、chapters、chunks；本任务将 v0 收窄为章节级 source 文件 + 小 manifest + 极简 chapter index。
- 游戏前端应通过 `@tsian/play-bridge` 领域 API 与平台交互；`packages/play-bridge/src/tsian-api.ts` 已暴露 `tsian.workspace.read/list/search/write` 和 `tsian.invokeAgent`。
- 默认 packaged frontend 当前不维护；本任务在 `apps/play-frontend-dev` 开发小说导入体验，后续等开发前端完善后再替换默认 packaged frontend。
- 当前 semantic index/chunk 能力主要面向历史、记忆或 workspace 搜索，不应假设已有专用小说 source corpus 分章/分块管线。

## Requirements

- `R1` 导入入口：默认游戏前端提供开局向导第一步，支持粘贴文本和选择 `.txt` / `.md` 纯文本文件。
- `R2` 当前 save 写入：导入结果必须写入当前 Save Instance workspace，不回写 Game Card 模板或其他存档。
- `R3` 保守 normalization：统一换行、去 BOM/NUL/明显控制字符、裁剪行尾空白、压缩过多空行，同时保留段落边界和原文措辞。
- `R4` 章节级 source：系统保存规范化后的章节级 source 文件；第一版不默认额外保存完整全文副本。
- `R5` 章节识别：实现 strong / medium / weak 三档章节识别；无副标题章节如 `第三章` 应算有效章节。
- `R6` fallback 切分：章节不清晰时生成约 15k 中文字符的 pseudo chapters，优先段落边界。
- `R7` 稳定命名：章节路径使用 `chapter-0001.md`，fallback 使用 `pseudo-chapter-0001.md`，标题不得作为主路径。
- `R8` 小 manifest：`manifest.json` 只记录全书级摘要、导入策略、章节检测方式、文件索引路径和处理状态，不内联完整章节列表。
- `R9` 极简章节目录：`chapters.index.json` 只要求 `{ path, title }[]`，数组顺序即章节顺序。
- `R10` 单次导入：已存在 ready manifest 时，不展示普通玩家可点击的重复导入/替换 source 入口。
- `R11` 前端反馈：导入 UI 显示待导入、读取、规范化、章节识别、写入 workspace、成功/失败等状态。
- `R12` 导入后占位：导入成功后显示导入摘要和下一步开局向导/初始化流程占位。
- `R13` API 边界：前端导入逻辑只使用 `@tsian/play-bridge` 领域 API，不直接使用裸 postMessage/RPC method 字符串。

## Acceptance Criteria

- [ ] 未导入 source 的默认小说 AIRP save 首次进入时显示导入小说向导，而不是普通聊天空状态。
- [ ] 玩家可以粘贴小说文本并导入。
- [ ] 玩家可以选择 `.txt` 或 `.md` 纯文本文件并导入。
- [ ] 导入成功后 workspace 存在 `save/source/manifest.json`、`save/source/chapters.index.json` 和章节级 source 文件。
- [ ] 有清晰章节标题的文本生成 `chapter-0001.md` 等文件，章节标题写入 `chapters.index.json`，不进入文件路径。
- [ ] `第三章` 这类无副标题章节可被识别为有效章节边界。
- [ ] 无章节或章节不清晰文本生成 `pseudo-chapter-0001.md` 等文件，目标约 15k 中文字符并优先段落边界。
- [ ] `manifest.json` 不内联完整章节列表，至少包含 title、importedAt、sourceFormat、importMode、recommendedExtractionMode、normalizationVersion、chapterDetection、chapterDetectionConfidence、totalCharacters、chapterCount、files、status。
- [ ] `chapters.index.json` 的章节条目只要求 `path` 和 `title`，不默认包含 `id/index/kind/characterCount`。
- [ ] 导入阶段不会为长篇小说默认写出大量 chunk 文件或额外完整全文副本。
- [ ] 已导入 source 的 save 不展示普通玩家可用的重复导入入口；玩家不满意导入内容时通过平台新建存档重新开始。
- [ ] 导入失败不会写入 `status: "ready"` 的 manifest，UI 留在导入向导并展示错误。
- [ ] 导入成功后 UI 展示摘要和“下一步：开局向导/初始化流程”占位，不实现完整开局对话。
- [ ] `情花孽.txt` 样例可作为手测参考：识别出前三章，其中第三章无副标题仍被识别。

## Out of Scope

- epub、pdf、docx、网页抓取、在线书库、DRM/版权流程。
- 整本小说语义理解、全局角色表、地点表、事件线、时间线抽取。
- 广告/作者话/站点信息的强语义清洗。
- 默认 Agent 阵容的具体落地、prompt 改写、Skill 编写和前端 `invokeAgent` 工作流。
- 开局向导完整流程，包括原著角色卡片选择、原创角色访谈、draft 确认、正式 player/entity 落盘和 master 首段剧情接管。
- 玩家身份选择、剧情跟随/改写/自由同人设置和开局组装。
- 修改 `apps/platform-web/src/storage/default-frontend-files.ts` 默认 packaged frontend；本任务只维护 `apps/play-frontend-dev`。
- 重复导入、source 版本管理、active source 切换和旧 sourceRefs 迁移。
- 平台级硬权限隔离或剧透控制。

## Open Questions

None currently.
