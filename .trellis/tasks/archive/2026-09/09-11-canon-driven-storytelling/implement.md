# 实施结果与验证（2026-09-11）

## 当前状态

**2026-09-12 用户最终验收通过，任务完成并归档。** 用户确认：“没问题了，此次任务圆满结束，相关任务也可以收尾归档了。”此次验收覆盖主流程与 0.3.1 属性/角色标题后续修正，无本任务遗留待办；这是用户整体实测结论，不扩展为未提供的逐项基准或量化性能承诺。

0.3.1 补齐属性估值/缺省维度、保留既有数值并修复长简介标题。最终测试包及 9 文件 76 测试、类型检查、真实浏览器布局与真实卡包/Worker 证据见 [follow-up.md](./follow-up.md)；[test-checklist.md](./test-checklist.md) 保留作回归参考。下文保留 0.3.0 原始工程交付记录。

本次收尾仅记录验收、更新导航和归档本任务及三项已完成前置任务，没有追加业务修改或重复构建；既有测试包原样保留。工程实施与收尾未调用真实/付费 AI，未自动 Git commit/push。

保留了进入会话时的未提交开局语义化实现及无关在途改动，没有 reset/clean/stash，也没有恢复废弃平台模板或卡内旧前端副本。HEAD 仍为 `191cd02e`，Git 总差异含前序任务，不能当作本任务单独变更一次性提交。

## 实际交付

### 1. 原著与正文

- 新增共享 `workspace/skills/原著阅读/`：`read_source` 连续读取、`locate_source` 关键词/章节定位；复用现有 source manifest/index/shard 读取，返回真实章节标题、章内范围、截断和 continuation。无需知道物理路径，可读任意必要前后文。
- 新增卡前端 `lib/story-source.ts`，开局与正式回合均实际注入连续原文及世界规则，不只是列出一个可选工具。默认 8,000 字符，Skill 上限 12,000；单次最多 20 个章节片段，位置按原始 UTF-16 偏移连续衔接。
- 写手可显式保存检索书签；书签不改变 runtime，也不是 frontier 或剧透访问锁。原著材料读取失败时阻断新发送并显示错误，而非默默退回仅摘要写作。
- 剧情访谈迁至写手本地 `开局访谈` Skill，方案仍由界面显式确认；访谈 transcript 身份/恢复同步适配。
- 原作文风改为直接参照原文，不再学习后回写模块。保留原作文风和行动选项的真实宏注入，停用冲突/不必要的移植材料；不建立新预设框架、不特判“继续”、不增加决策确认、固定大纲或差异报告。

### 2. 世界适配与开局一致性

- 架构师 `submit_initial_world` 只接收 world/summary，仅生成世界/schema 规则及 pending 摘要，不接收或预建人物、物品、场景、关系、主角/位置。
- 内部 `opening-state.model` 字段名保留，但只是世界适配文件签名/提交 ID，不再要求实体库。独立正文 slot、投影 transcript、Frontend Action 原子发布和完成边界保持。
- turn 0 场记材料包含已落定正文、确认前提、世界规则和已有本局资料；允许空初始 runtime，首次创建对象后用 @key 建立主角、地点和活跃场景引用。首次提交必须验证主角确实在当前地点的活跃场景内，之后 runtime.turn=1。
- 已确认阶梯/同阶评价可转换为可渲染整数属性；装备槽、贡献、容器引用由程序确定，未知值不要求猜测。普通维护不能更换主角身份。
- 没有提交凭据的“已完成”仍不能成功；正文已经保存就复用，维护失败只重试维护；刷新不静默调用模型，格式错误正文只允许显式重试再生成；开局/首回合 checkpoint 逻辑保留。

### 3. 本局身份与历史

- lookup 完整分页枚举实体/场景，规范化名称/别名匹配，返回 searchComplete、unmatchedNames、nextOffset；结果页上限不等于全库缺失。稳定内部 ID 不变，改名保留旧名，场景也支持别名。
- 创建前程序检查已有及同批对象：未解决候选时整批不写业务资料/凭据；同一对象改用 ref，真实同名对象必须列出 distinctFrom 与具体区别，不自动合并或覆盖。候选按首个未解决冲突返回，并报告 remainingConflicts。
- 紫星塔测试直接提交创建而不 lookup，程序能拦住重复创建；问题不归咎于 UUID。
- 时间线从 turn.meta.recall 的“重要节点”与既有“摘要”派生，只含已提交的重要历史，不另写一份剧情摘要。无记录是正常空态。
- 删除旧 useFrontier/useFrontierAdvance、图表源节点类型/解析/未来摘要，以及旧 frontier 推进 Skill。取消活跃维护协议和材料中的 milestones、plotOrder、对齐/偏离；旧资料聚合工具也不再读取 frontier。确定性历史召回不再投影剧情坐标；向量/RAG 功能及保留的废弃 RAG 工具未改造。

## 验证证据

### 确定性测试：7 文件，64 测试通过

```powershell
npm exec vitest run -- apps/platform-web/src/integration/canon-storytelling.test.ts apps/platform-web/src/integration/opening-modeling.test.ts apps/platform-web/src/integration/opening-setup.test.ts apps/platform-web/src/integration/stage-manager-maintenance.test.ts apps/platform-web/src/integration/stage-manager-sync.test.ts apps/platform-web/src/integration/assistant-runtime.smoke.test.ts apps/platform-web/src/bridge/remote-iframe-bridge.test.ts
```

覆盖：实际 Skill 可见性与完整 use_skill 观察、真实启用模块宏展开；连续原文/跨章/章内截断/后续定位、书签不改事实；无预建实体开局、缺主角指针拒绝、属性/装备/同批引用；紫星塔不 lookup 创建保护、改名别名、真实同名不同对象、430 对象的跨页检索、同批冲突与写入失败回滚；本局历史与无文件空态；正文复用、显式重试、无凭据不成功、turn 0/1/checkpoint 及桥接回归。

### 类型与构建

- `npm exec vue-tsc -- --noEmit -p apps/play-frontend-dev/tsconfig.json`：通过。
- `npm exec vue-tsc -- --noEmit -p apps/platform-web/tsconfig.json`：通过。
- `npm run build:web`：通过。
- `git diff --check`：通过（仅有已有 CRLF/Git ignore 访问警告）。
- 构建有现有动态/静态混用 import、较大 chunk 及第三方 pure annotation 提示，无构建失败；未为这些提示扩大任务。

### 最终真实卡包与 Worker

```powershell
npm run package:card -- --out tmp/immersive-reader-canon-storytelling.tsian-card.zip
```

最终通过真实 Chrome 的平台构建、卡包导出/导入往返、卡属 initial-save/checkpoint、路径/字节/清单与 ZIP 完整性核验。导入后的真实 browser Skill Worker 和隔离 Frontend Action Worker 进一步验证：

- 世界适配不预建实体、真实原文注入；
- 建模及正文发布原子性、无效输出回滚、显式重试和正文保存；
- turn 0 首次建档与提交凭据、首个正式回合推进；
- 未 lookup 创建拦截、别名查询、同名仿品明确区分、不覆盖原物；
- 重要历史复用已落定摘要；
- 原有场记写入/输出失败回滚与幂等。

首次沙箱内 Chrome GPU 子进程被环境阻止；按审批在沙箱外使用临时隔离浏览器完成验证，没有使用真实用户存档或模型。

## 最终测试包

- 路径：`tmp/immersive-reader-canon-storytelling.tsian-card.zip`
- 卡版本：`0.3.0`
- 文件数：296（166 workspace、116 frontend source、13 frontend dist、1 cover）
- 大小：7,079,034 bytes
- SHA-256：`503F56B1EA7DBBC859CDA024C14EAEA44B727F4C375870F5C4A1F8F6AE8B9938`
- 用户实测清单：[test-checklist.md](./test-checklist.md)

## 复盘与剩余边界

两项值得保留的实现经验已更新至实际使用的 frontend/type-safety.md 段落：共享 Skill 必须使用共享 scope，不能靠跨 Agent 本地路径启用；enabledModules 白名单不等于模块已注入，还必须检查真实宏展开。两者均有确定性测试覆盖。

没有未解决的已确认工程缺陷。名称判断和正文事实提取仍有语义判断部分；提示词不能保证零剧透，实际剧情/文风/速度未测。后续从用户实测反馈继续，不要把本次工程通过报告成模型质量通过。
