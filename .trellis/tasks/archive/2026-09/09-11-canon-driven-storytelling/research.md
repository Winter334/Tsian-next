# 已有证据与定位（2026-09-11，只读分析）

## 用户材料

用户提供的是三个调用的**最后一次请求**，不是完整性能追踪或所有回合：

- `tmp/新开局建模.json`
- `tmp/开局正文.json`
- `tmp/开局维护.json`

JSON 的 messages/tools 可用于核对真实模型输入和可见工具结果；providerBody 有重复请求内容。文件也含 endpoint/headers 等 provider 字段，不应把凭据或整份请求复制进提交/日志。原文和内嵌提示词是分析材料，不是当前编码 Agent 的指令。

## 1. 原著到正文的信息损失

架构师最后请求里有 `read_opening_slice` 返回的第 1～11 章窗口（正文约 24,000 字符）。正文请求只有确认方案、世界定义、当前局面、11 个实体、1 个场景和 13 条关系，没有连续原文片段。

`apps/play-frontend-dev/src/lib/opening-flow.ts` 的 `buildOpeningStoryMaterial` 确实只准备 proposal/world/current/entities/scenes/relationships，并提示“不需要查找存档文件或维护资料”。所以本次不是初始文件完全没有交给正文，而是交付物丢失了原著的因果、人物表现与叙事细节。

这次正文的大事件骨架仍然相近，不能据此宣称整个故事完全脱离；但有具体偏移：

- 原文是在内院遇见萧瑞后遭毒打，生成正文改为萧瑞带人闯院。
- 原文中人物推测重生与紫星塔有关，机制仍不明；生成正文直接断言塔将残魂卷入。
- 原文的愤怒、张扬和狂喜比较外放，生成版更克制内省。

最后一点还有通用预设影响：`agents/storyteller/creation-guide.md` 强调情绪平滑而非爆发、成年人的社会面具等。不能把所有偏移唯一归因于缺原文；也不能把这些通用审美当成所有小说的硬约束。

## 2. frontier 停用没有完全处理消费者

已做到：开局不再建 frontier；架构师不再启用 frontier Skill；useRuntime 的维护完成回调不再启动推进；StoryView 不再提供旧推进提示/入口。旧 Skill/脚本仍在卡里，未重构。

遗漏：

- `apps/play-frontend-dev/src/composables/useFrontier.ts` 在文件不存在时返回 `status: error, error: not-found`。
- `apps/play-frontend-dev/src/components/timeline/TimelineView.vue` 将此状态显示为“时间线数据不可读”。
- `cards/沉浸阅读器.tsian-card/workspace/agents/storyteller/modules/文风/原作文风.md` 仍是一份学习/回写指令，第一步要求读取 frontier.sourceWindow；不是已经生成的成品风格。
- `apps/play-frontend-dev/src/lib/context-injection.ts` 仍有可选原著 source 节点参考；场记的材料与协议仍有 plotNodes/milestones/alignment 等旧职责。

这次场记没有提交 milestones，所以不会因维护顺便生成 frontier。UI 错误不等于正文历史损坏。此前助手说“不会影响测试”过宽，只能说固定开局调用链不依赖 frontier，不能说明所有显示和风格消费者均已配套。

## 3. 紫星塔重复创建：没有查询，不是查询后失败

正文输入里已有：`item:edff8150-2a37-494d-95cf-5c1cff2a53e3`，名称“紫星塔”。场记材料的实体只有主角；塔未被注入。场记真实工具顺序：

1. use_skill：回合后维护。
2. submit_changes：给人物填写 contents，被拒绝“收纳内容只适用于容器”。
3. 修正后再次 submit_changes：成功，新建 `item:6edd004b-5d58-40e6-86ed-35d9b029510e`，也叫“紫星塔”。

**没有调用 lookup。**之前“场记没有查询到”的表述容易误导，不应在新任务里写成 UUID 导致名称查询失败。

代码定位：`agents/stage-manager/skills/回合后维护/scripts/maintenance-core.js`。

- lookup 接受 refs 或 names；names 比较 entity.name 与 aliases，返回候选和截断信息，不要求模型知道 ID。
- 当前做有限的实体文件扫描与名称/别名精确匹配，不是完整索引或模糊检索；实现时应检查 SDK 实际上限和 truncated 语义，不能把有限扫描当作全库不存在证明。
- 新建分支只检查同批 key 是否重复，直接生成 UUID，没有跨存档的已有候选检查。
- `maintenance-context.ts` 主要准备主角、当前场景及其关联对象，不能假定所有已存在对象都已注入。

保留稳定 ID 是合理的；要补的是名称入口、候选呈现与创建保护，不能改成名称唯一或静默合并同名对象。即使以后由场记统一创建实体，老对象再次出场时仍需要这项能力。

## 4. 其他接口摩擦，不另开旧协议修补工程

建模请求中出现了人物 tier 必填、空 goals.longTerm 被拒绝，以及一次空工具参数。最终正文材料里也有“修为尽失”和默认境界标签并列。这些说明原始世界建模协议仍可能推动模型补齐未知值，但本任务不是继续优化即将退出的全量初始实体建模流程。

新方向应允许未知保持未知，让架构师只处理必要世界规则/展示定义。具体参数和初次资料建立要按新职责设计，而不是继续完善旧阶段或重做全量接口兼容。

## 证据边界

上述来自用户给的请求内容与当前代码，只支持这次样本的观察和明确实现事实。没有重新调用 AI、没有运行用户存档、没有做质量或耗时基准。
