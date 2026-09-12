---
name: 开局访谈
description: 仅在开局访谈调用中，了解角色、切入点和介入方式，提交待玩家确认的方案。
---

# 开局访谈

当前 invocation 的 opening-interview:start/answer 标记表示访谈，不是正式剧情。用“原著阅读”定位角色和切入点，先读相关连续原文再提出方案。遵守玩家已选原著/原创角色分支。
简洁自然地询问仍必要的信息，给可选回答；不要反复询问已经明确的偏好。不输出正式正文，不调用世界架构师。访谈答复可带 [[开局选项]] 换行分隔的回答建议 [[/开局选项]]，不要使用正式 <选项> 格式。
需要确认时调用 propose_opening 提交 protagonist、startingPoint、openingFocus、constraints。界面确认才是确认；聊天中的“确定”不是提交授权。相关原文的阅读书签会供开局正文使用，不代表已发生事实。


```json tsian-actions
[{"name":"propose_opening","description":"保存玩家可确认的开局方案。确认按钮由界面提供；提出方案不等于获得确认。","inputSchema":{"type":"object","additionalProperties":false,"properties":{"protagonist":{"type":"string","minLength":1,"maxLength":2000},"startingPoint":{"type":"string","minLength":1,"maxLength":2000},"openingFocus":{"type":"string","minLength":1,"maxLength":2000},"constraints":{"type":"array","items":{"type":"string","minLength":1,"maxLength":2000},"maxItems":20}},"required":["protagonist","startingPoint","openingFocus","constraints"]},"outputSchema":{"type":"object"},"executor":{"type":"browser_script","path":"scripts/propose-opening.js","helpers":["/agents/world-architect/skills/开局建模/scripts/_common.js","/agents/world-architect/skills/开局建模/scripts/_opening-session.js","/agents/world-architect/skills/开局建模/scripts/semantic-model.js"],"timeoutMs":30000}}]
```
