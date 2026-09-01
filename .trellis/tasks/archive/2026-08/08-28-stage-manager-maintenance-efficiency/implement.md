# 执行计划：场记回合后维护效率优化

工作根目录：`cards/沉浸阅读器.tsian-card/workspace/`（下文路径均相对于此）

**总原则：平台侧零改动。** 每批次结束后 `git diff --stat apps/` 必须为空。

## 批次 0 · 调研确认（无写入）

不产生任何文件改动，只收集实施所需的准确事实。

- [ ] 0.1 读 `agents/stage-manager/tools/commit_turn_recall/run.js`，
      抄录 `事件类型` 的**实际校验数组**（R5 用，不从 design.md 转抄）
- [ ] 0.2 读 `agents/stage-manager/skills/回合后维护/SKILL.md`，
      定位固定流程**第 1 步**（R3 措辞）与**第 3 步**（R6 引导）的原文与行号
- [ ] 0.3 读 `agents/stage-manager/AGENT.md`，定位工具说明段落（R6）
- [ ] 0.4 读 `tools/text_edit/run.js` 的 `validateMemoryLines` 与
      `assertMemoryOperationLines`，确认两处 `fail` 的精确位置

**门禁：** 0.1 的枚举值必须逐字确认，与 `prd.md` R5 所列 15 项比对；不一致以代码为准并回写 prd。

## 批次 1 · `tools/text_edit/run.js`（R1 + R4）

同一文件，合并改动一次验证。

- [ ] 1.1 **R1**：`validateMemoryLines` 中 records 分支与 seeds 分支的
      `if (!parsed) fail(...)` 各改为 `if (!parsed) continue;`
- [ ] 1.2 **R1 可观测**：`tsian.trace('text_edit', {...})` 增加三个 memory 观测字段——
      `skippedMemoryLines`（跳过的非法条目行数）、`memoryEntryCount`（合法条目数）、
      `memoryCharCount`（文件字符数）。后两项服务于 `prd.md`「R3 附带」段的分片阈值观测
- [ ] 1.3 **R4**：新增 `MEMORY_FORMAT_HINT` 常量（records / seeds 各含
      `expectedFormat` + `example`，内容见 `design.md` R4）
- [ ] 1.4 **R4**：`assertMemoryOperationLines` 的 `fail()` details 带入
      对应 kind 的 `expectedFormat` 与 `example`
- [ ] 1.5 确认未触碰 `parseRecordLine` / `parseSeedLine` /
      `isRecordEntryCandidate` / `isSeedEntryCandidate` / `validateSeedTransitions`

**验证：**

```bash
# 语法检查（该文件含顶层 return，不能用 node --check）
node -e "new Function(require('fs').readFileSync('cards/沉浸阅读器.tsian-card/workspace/tools/text_edit/run.js','utf8'))" \
  && echo "syntax ok"
```

**活体检查（R1）：** 对含说明行的 `seeds.md` 直接 append 一条 seed → 应一次成功。
**活体检查（R4）：** 提交一条格式错误的 records 行 → 返回应含 `expectedFormat` 与 `example`。

**回滚点：** 仅此一个文件，改动前留存原内容即可整体还原。

## 批次 2 · `skills/回合后维护/workspace-map.md`（R2 + R5）

纯文档。

- [ ] 2.1 **R2**：第 7 行位数注解 `turn-00001.json` → `turn-000001.json`；
      补明开局回合 = `turn-000000`、玩家首回合 = `turn-000001`
- [ ] 2.2 **R2**：新增 ref → path 转换规则小节，覆盖 character / item / container /
      location / scene / relationship 全部类型（见 `design.md` R2）
- [ ] 2.3 **R5**：在 `commit_turn_recall` 相关位置补 15 个 `事件类型` 枚举值
      （用批次 0.1 抄录的实际数组），并标注该字段为**数组**类型

**验证：** 文档 review——位数与实际文件名一致；任一 ref 可据规则推出唯一路径；枚举齐全。

## 批次 3 · `agents/stage-manager/agent.json`（R3 配置）

- [ ] 3.1 `contextPaths` 追加四条（保留既有 `workspace-map.md` 条目）：
      `save/schema/current.md`（prelude）、`save/playthrough/runtime.json`（runtime）、
      `save/memory/records.md`（runtime）、`save/memory/seeds.md`（runtime）
- [ ] 3.2 确认 `tools` / `platformTools` / `skills` / `workspaceAccess` 未被误改

**验证：**

```bash
node -e "JSON.parse(require('fs').readFileSync('cards/沉浸阅读器.tsian-card/workspace/agents/stage-manager/agent.json','utf8'))" \
  && echo "json ok"
```

**回滚点：** 单文件，改动前留存原内容。

## 批次 4 · `SKILL.md` + `AGENT.md`（R3 措辞 + R6 引导）

两处需求都改这两个文件，合并为一批避免相互覆盖。

- [ ] 4.1 **R3**：`SKILL.md` 固定流程第 1 步——将 runtime.json / current.md /
      records.md / seeds.md 的读取指引改为「基于上下文已注入的内容」，
      仅保留 turn 文件的读取指引
- [ ] 4.2 **R6**：`SKILL.md` 第 3 步——`query_entities` / `read_entities`
      从描述性表述改为明确的首选路径指令，并补失败回退原生 `read` 的许可
- [ ] 4.3 **R6**：`AGENT.md` 工具说明段落同样点明实体 / 关系读取的首选工具
- [ ] 4.4 通读两文件，确认无残留的「读 runtime.json / records.md / seeds.md」表述

**验证：** 文档 review——第 1 步不再要求读已注入文件；第 3 步为指令式且含回退许可。

## 批次 5 · 整体验证

- [ ] 5.1 `git diff --stat apps/` 输出为空（零平台改动）
- [ ] 5.2 `git status` 确认改动文件恰为本计划列出的 5 个
- [ ] 5.3 活体检查：以同一份 `turn-000001` 数据重跑一次回合后维护
- [ ] 5.4 记录对比基线（29 轮往返 / 约 70 次工具调用 / 13 次失败），写入任务 notes

**5.3 的观察点：**

| 观察项 | 期望 |
|---|---|
| 流程第 1 步的 read / list 次数 | 0（四个文件已注入） |
| `seeds.md` 首次写入 | 一次成功 |
| turn 文件路径 | 一次读对 |
| `commit_turn_recall` | 一次成功 |
| 实体 / 关系读取 | 走 `query_entities` / `read_entities`（R6 观测项，未达成不阻断） |

## 不做

- 不动 `apps/platform-web/**`（含已废弃的 `workspace-templates/`）
- 不新增 `read_scenes`，不恢复 `read_maintenance_context`
- 不改 `json_edit` / `commit_turn_recall` / `query_entities` / `read_entities`
- 不建持久化测试套件（遵循项目既有约定，采用按需活体检查）
- 不执行 `npm run package:card`（打包是发布动作，非本任务验收项）
- 不做 git 提交（待 Trellis 3.4 阶段，需用户确认）

## 顺序依赖

批次 0 必须先行（0.1 供 2.3、0.2/0.3 供批次 4）。
批次 1 / 2 / 3 相互独立，可任意顺序。
批次 4 依赖批次 3（措辞改动的前提是注入已配置）。
批次 5 依赖全部。
