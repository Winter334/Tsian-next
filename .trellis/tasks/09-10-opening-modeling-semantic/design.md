# 现状分析与方向（尚未实施）

## 当前链路

前端导入小说、选择 canon/original 分支 → invoke world-architect 访谈 → 读取源文本/确认主角与切入点 → 直接填写 schema/current.md → commit_opening_entities → commit_opening_graph → commit_opening_state → agent_call storyteller → 架构师核对正文 → publish_opening → setup-summary.status=complete。

Skill 当前安排实体+关系可以同 invocation，state 与正文发布各自独立；前端识别 [[开局继续]] 自动继续，最多 3 次自动衔接。工作笔记负责记录已确认事实、读过章节、切入点、世界口径、writes 路径、阶段和下一步。

## 六个 action 的实际边界

- inspect_source_opening / read_opening_slice：已经封装源 manifest/index、分片位置、章节读取，Agent 选择章节范围；返回文本、章节标题/编号、截断信息和少量源标识。是现有较好的专用工具边界，不需先推翻读取系统。
- commit_opening_entities：输入仍是近乎存储同形的完整 entities，要求 Agent 编 id、brief 及各类字段。脚本规范路径、容器/item 默认值、全量路径集合与阶段锁；大量字段仍以 {...raw} 原样落盘。
- commit_opening_graph：要求完整 scenes 和按 subject 分片的 relationships，含 present[{ref}]、location{ref}、edges[].to/type。脚本校验已提交依赖，补引用名字和 since，未将“一段关系事实”转换为合适的双向分片。
- commit_opening_state：输入 runtime/frontier/summary，Agent 仍组装存储模型。已有良好自动化：turn/updatedAtTurn、source 章节索引与 extractedThrough、source order、updatedAt、setup pending；切入点 entryAnchorIndex 的选择是语义，映射到 plotOrder 才是程序操作。
- publish_opening：已自动投影 storyteller 正文、校验正式选项格式、写 turn 0 与 player context、切换 complete；正文通过 responseRef 传递，不要求模型重抄。可保留此程序核心。

## 仍交给 Agent 的系统维护

1. 每次先读 workspace-map 和笔记，掌握路径/分片/完整性/锁定/恢复规则。
2. 世界定义写 Markdown，实体和 graph 输入近乎完整 schema；没有专门提交“世界概念、维度、成长规则和展示意图”的 action。
3. 属性规范混合语义判断与明确公式。力量档位、维度分类、异常角色如何偏离属于判断；q/区间/线性插值/可展示结构适合程序计算。
4. 关系“是否相互成立”属于语义；维护哪些 subject 文件、双向落盘和存在性不是模型职责。不能自动把单向认知/态度变成相互关系。
5. 从 files + notes 判断首个未完成阶段、抄 writes 路径、发 continuation、重读已落盘对象组装下一层和委托写手，仍是在人工运行状态机。
6. 发布检查混合事实一致性/剧情终点/选项可执行性与对象引用存在/结构合法性；后者可程序接管，前者不能用字符串规则冒充语义理解。

## 发现的明确不一致

- SKILL.md:96 宣称每次 invocation 上下文清空，但 useSetupState.ts:507 的真实调用使用 persist:true +固定 contextSlot + full transcript，未见调用前清空。由此同时存在持久上下文与“笔记是唯一记忆”的错误假设。
- SKILL.md:209 让发布检查发现资料错误时回对应阶段修正，但 entities action 在 graph/state 已有时 LOCKED，graph action 在 state 已有时 LOCKED。仅相同内容重提幂等不等于可修正；raw json_edit 虽可绕过专用提交限制，也正说明职责边界不闭合。
- workspace-map 要求关系涉及角色各有 subject，并允许单向关系，却又禁止空 edges。纯单向关联时这套分片完整性要求不自然，应将关系语义和文件生成拆开，而不是让 Agent 补造关系。
- state 对缺失/越界 entryAnchorIndex 默认第一个节点。界面所需语义切入点可以在工具合同中直接表达并验证，避免要求模型记数组位置与默认回退后果。

## 不宜照搬的改法

08-21-opening-modeling-submit-workspace 已记录：过去末尾一次携带全部模型+正文的提交有过失败，才引入耐久阶段。不能再让模型捏住全部存储格式和正文直到最后，但这段历史也不能证明现有阶段锁或分阶段模型调用必须保留。用户进一步要求评估阶段锁的必要性；语义提交、程序内依赖解析和一次事务写入应与旧巨型原始文件提交区分。

world-architect 同时运行 frontier推进，且共享 AGENT/agent.json/contextPaths/原生工具权限。这意味着改动会影响 frontier，但用户已明确接受这种影响；frontier 不再是本轮必须保留的约束，未来大概率移除或重构。不要为了兼容这套待退役/重构流程，限制开局的语义化设计。

## 建议方向

从“访谈＋schema文件编辑＋完整JSON提交＋流程管理＋发布审查”转为“确认玩家意图＋声明世界语义＋落成切入点世界快照＋必要语义复核”。程序准备阶段材料、分配标识/包装引用、计算刻度、形成 schema/渲染文件、管理提交与恢复、准备写手材料并执行发布。现有读取工具与发布核心优先复用，不先削减世界定义/语义审查或修改 RAG。

## 证据入口

- cards/沉浸阅读器.tsian-card/workspace/agents/world-architect/{AGENT.md,agent.json}
- 同目录 skills/开局建模/{SKILL.md,workspace-map.md,scripts/*}
- 同目录 skills/frontier推进/SKILL.md（仅核对共享边界）
- apps/play-frontend-dev/src/composables/useSetupState.ts
- apps/play-frontend-dev/src/lib/opening-interview.ts
- cards/沉浸阅读器.tsian-card/workspace/initial-save/schema/current.md
- cards/沉浸阅读器.tsian-card/workspace/docs/属性刻度规范.md
- .trellis/tasks/archive/2026-08/08-21-opening-modeling-submit-workspace/prd.md
- .trellis/tasks/archive/2026-09/08-30-opening-modeling-prompt-refactor/implement.md


## 用户纠正后的讨论方向（2026-09-10）

1. 不把“发现正文差异 → 让架构师回到已锁阶段修正”作为修复目标。先保证模型资料进入正文 Agent 的实际输入；正文消费质量后续单独优化，正常叙事变化不应等同于建模错误。
2. 实体→graph→state 是当前存储依赖，不一定需要成为模型必须理解的顺序。语义输入可以由程序解析依赖、创建文件；是否还需阶段锁从新职责划分重评。
3. 保留真正的数据安全边界（玩家确认、正式游玩后防止开局覆盖、失败不留下半套可用资料、重复执行保护），不将其与旧阶段锁混为一谈。
4. 不再为兼容 frontier 强制开局生成 sourceWindow/timeline/order 等整套资料。源文本读取与事实取证仍有用；范围/剧透约束与剧情坐标是否需要保留，在后续设计中分别判断。plotOrder 属于语义字段，不等于其所属功能必须永久存在。
5. 用户已确认统一职责方案：架构师定义开局前资料，正文 Agent 叙述开局，场记根据已落定正文更新开局后状态。开局也运行一次场记；当前场记准备脚本只接受正数正式回合，实施时需明确支持 turn 0。用户认可方向，不等于该能力已经实现。


## 职责链确认后的设计收敛

- 架构师的交付是可被正文消费的初始世界，而不是预先猜出正文终点的一套存档，再逐项对照正文修正。初始事实为续写提供约束；剧情落定后的变化由场记维护。
- 卡内程序编排“访谈确认 → 初始资料提交 → 正文生成/保存 → 场记维护 → 开局就绪”。不让架构师用文件清单、阶段锁和 continuation 文字管理物理执行顺序。
- 建议完成边界：只有开局正文已保存且场记维护成功，才进入可开始正式游玩的状态。已有 publish_opening 目前写入 turn 0/player context 时立即设置 setup complete，因此实施需调整，不应直接先宣布 complete 再静默补维护。
- 重试按实际已提交结果恢复：正文失败不重新访谈/建世界；场记失败不重复生成正文；重复触发不重复写入开局回合或维护记录。这是程序一致性与恢复能力，不是恢复旧实体/graph/state 锁。
- 未引入新通用工作流引擎、兼容层或 RAG 依赖。具体如何拆分卡脚本与前端调用，在实现设计中决定。
- 下一项语义协议设计聚焦两类输入：世界定义（概念/维度/力量规则/展示意图）与初始资料（人物/地点/物件/关系/开局局面）。确定性刻度、渲染结构和物理引用由程序生成。


## 已确认：由卡前端程序发起固定后续调用

用户已认可固定开局职责链由卡层程序编排，在现有项目中落于实际卡前端的调用逻辑；不由架构师 agent_call 写手/场记，不让通用平台理解玩法 schema，也不新增通用工作流引擎。

- 架构师仍判断访谈是否充分、玩家选择是否明确，并提交初始世界；程序以成功的资料提交结果判断可进入下一步，不靠模型口头宣布或计数访谈轮次。
- “初始世界准备成功 → 正文 → 场记 → 开局就绪”是已确定的流程，不需要模型再判断该调用谁。把后续调用留给架构师会再次加入调度/转交/等待/判断成功职责，也让架构师的上下文接收职责外的正文与维护结果。
- 每次 invokeAgent 的提交是独立边界：先把初始资料提交落盘，再调用正文，保存正文后再调用场记。与现有父 invocation 内 agent_call 共用 live staged workspace 的语义不同，实施时须明确顺序。
- 现有 responseRef 是单次工具循环局部引用，不能跨独立 invocation 转交；改由程序接收原始响应并交卡脚本保存/发布，不让模型重抄正文。
- 必要完成状态存于存档，不只留在 Vue 内存；失败只恢复未完成步骤，避免重做模型调用。刷新恢复不静默重复调用 AI。
- agent_call 适用于下一步确实依赖语义判断的可选咨询/委托，而不是已经固定的开局流水线。当前不必为假想动态流程保留架构师对写手/场记的常规调度。

此决策已获确认；当前只记录设计，尚未改动业务调用链。


## 规划收敛（2026-09-10）

用户认可程序编排并要求创建任务。复用此前的同名研究任务，不重复创建；PRD 已收敛为确认的目标、边界与验收。无阻塞性产品待确认项。语义字段形状、action 拆分、卡内辅助文件与最小内部状态属于后续实现设计，不再逐项请求产品确认；如果发现需要扩大产品范围，则另行讨论。

上文“现状分析”描述改造前代码，“建议方向”保留推导过程；执行以当前 PRD 和已确认职责链为准，不把历史阶段锁、frontier 保护或架构师正文审核当作必须保留的约束。
