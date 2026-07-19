---
name: 资料检索
title: 资料检索
description: 在已读章节和现有实体/场景中按问题检索材料，找不到时返回简短说明。
triggers:
  - 调用方缺少源文本或世界事实
  - 需要在已读范围内定位相关内容
appliesTo:
  - researcher
---

# 资料检索

检索目标是“让调用方少读上下文也能行动”，不是展示你翻了多少资料。

## 工作方式

1. 确认调用方真正问的事实范围。
2. 读 `save/playthrough/frontier.json` 确定已读窗口（`sourceWindow.start` ~ `sourceWindow.end`）和 timeline 锚点。
3. 映射 `runtime.worldTime` 到 timeline 锚点，定位当前剧情对应的原著时间段。
4. 在已读范围内直接读相关源章节、entity、scene。用 `search` 在已读源内容中按关键词定位段落。
5. 找到 → 提取相关内容，返回精炼结论 + 来源章节/锚点 + 不确定性。
6. 找不到 → 返回“已在已读章节 1-8 及现有实体中检索，暂无相关内容”之类的简短说明。不告知哪里有未读章节。

## 不做

- 不推进 frontier（不读未读章节）。
- 不讲故事，不写存档。
