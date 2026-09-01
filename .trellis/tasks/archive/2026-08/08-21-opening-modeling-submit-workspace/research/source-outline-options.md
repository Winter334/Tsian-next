# 原著剧情大纲与 Timeline 复用研究

## 当前事实

- `save/playthrough/frontier.json.timeline` 已累积 source/player 两类锚点；source 锚点包含 `order/chapter/time/label`。
- source `label` 被契约明确限定为“一句话客观标签，不是剧情摘要”。所以现有 timeline 只有坐标骨架，没有足以支撑创作的剧情梗概。
- `frontier推进` 每次已经读取最多 15 章、识别 1–2 个语义剧情节点，再提交 source anchors；生成节点摘要不需要新增一次原文读取。
- 正式回合发送前，`context-injection.ts` 已选择当前 `plotOrder` 附近的 source anchors 注入 storyteller，并明确提醒未来节点不是已发生事实、不得当成必须复刻的剧本。
- stage-manager 的 `read_maintenance_context(includeTimeline:true)` 保留完整 source anchor 对象；anchor 增加可选字段后可直接帮助 plotOrder 语义映射。
- 历史设计曾提出 `save/director/current-brief.md`，但其语义是当前创作方向与防剧透约束，不是原著已读内容的客观大纲；当前卡也没有 director Agent。两者不应混为一份文件。

## 方案 A：source anchor 增加可选 `summary`（采用）

```json
{
  "kind": "source",
  "order": 2,
  "chapter": 4,
  "time": "三日后",
  "label": "街头赌斗",
  "summary": "萧凌外出采购时遭白奎拦截，双方以狼牙匕为赌注约斗；冲突把萧家内部矛盾带到大吉镇街面。"
}
```

约束保持轻量：

- 1–3 句客观梗概，只写 world-architect 实际读到的内容。
- 描述“发生了什么、关键因果、涉及谁”，不写创作指令、隐藏未来计划或强制玩家复刻。
- `summary` 可选；旧 anchor 和旧前端自然兼容。
- 开局建模写首批 summary；后续 frontier 推进随 source anchors 增量维护。

优点：

- timeline anchors 自身逐步形成原著剧情大纲，不新增第二套 order/chapter 索引。
- storyteller 现有附近节点注入可直接增加 summary，不需要新检索机制。
- stage-manager 自动拿到 summary，能更准确判断玩家处于哪个原著节点。
- 前端 timeline 可直接展示当前/已过去节点摘要；未来节点摘要默认折叠，由玩家主动点击查看，以低成本避免扫视剧透。

代价：frontier.json 会比现在更大；长篇小说可能累积数百个短 summary，但仍远小于原文，正式回合只注入附近节点。

## 方案 B：独立 Markdown 大纲

例如 `save/playthrough/source-outline.md`，按章节或节点写自然语言段落。

优点是 Agent 直接阅读体验更好、可写得更长；缺点是会和 timeline 重复维护 order/chapter/label，对 stage-manager 和 timeline UI 没有直接结构化连接，更新失败时还可能与 anchors 不同步。

独立 Markdown 更适合未来需要“长篇章回梗概、卷级概览、主题/伏笔分析”时再增加；当前只为时间线语义和 storyteller 附近剧情参考，source anchor summary 的成本更低、消费者更明确。

## 结论

本轮不新建独立大纲文件。把 optional `summary` 作为 source anchor 的自然语义补充；累积的 source anchors 就是与时间线同源的原著剧情大纲。storyteller 注入只取附近节点，但 Agent 始终可读取 workspace 中的完整 summary。

Timeline UI 对已有 summary 提供展示：当前和过去节点直接显示；未来节点保留现有 label/time，但摘要默认折叠并标明可能剧透，玩家点击后才展开。展开状态是纯前端临时交互，不写回 workspace，刷新后重置也不会损失任何模型资料。
