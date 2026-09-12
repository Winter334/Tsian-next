---
name: 开局建模
description: 玩家确认后进行世界与 schema 的语义适配，不预建对象库。
---

# 世界适配

加载“原著阅读”，按需了解作品的世界概念、力量层级、术语和规则；相关剧情供理解世界，不在这里规划正文。
调用 submit_initial_world，只提交 world 和 summary。沿用主要资料类别：人物、物品、容器、地点、场景。世界维度描述其实际含义，growth 随力量成长、talent 相对稳定、hybrid 混合；至少一个 growth 和两个 talent。power.scale 表达跨阶强度差异（gentle/moderate/steep），不是 Agent 手算数值。
维度 meaning 应说明该能力的含义与普通参照，阶梯序列应能容纳本世界的普通角色；不要求小说精确提供属性数字，后续场记按统一的相对评价基准 5 进行游戏化估值，程序换算。
不提交人物、物件、场景、关系、当前主角/地点或剧情节点。它们由正文落定后场记建档。不得手写文件、调度其他 Agent、访谈或冒充玩家确认。提交成功就结束。


```json tsian-actions
[{"name":"submit_initial_world","description":"提交世界概念、力量口径、属性含义和规则适配；不建立实体。","inputSchema":{"type":"object","additionalProperties":false,"properties":{"world":{"type":"object","additionalProperties":false,"properties":{"title":{"type":"string","minLength":1,"maxLength":150},"power":{"type":"object","additionalProperties":false,"properties":{"tiers":{"type":"array","items":{"type":"string","minLength":1,"maxLength":100},"maxItems":32},"scale":{"enum":["gentle","moderate","steep"]}},"required":["tiers","scale"]},"dimensions":{"type":"array","items":{"type":"object","additionalProperties":false,"properties":{"name":{"type":"string","minLength":1,"maxLength":80},"kind":{"enum":["growth","talent","hybrid"]},"meaning":{"type":"string","minLength":1,"maxLength":1000}},"required":["name","kind","meaning"]},"maxItems":8,"minItems":4},"rules":{"type":"array","items":{"type":"string","minLength":1,"maxLength":2000},"maxItems":30},"terms":{"type":"string","maxLength":5000,"minLength":1},"equipmentSlots":{"type":"object","maxProperties":20,"additionalProperties":{"type":"integer","minimum":1,"maximum":10}}},"required":["title","power","dimensions","rules"]},"summary":{"type":"string","minLength":1,"maxLength":2000}},"required":["world","summary"]},"outputSchema":{"type":"object"},"executor":{"type":"browser_script","path":"scripts/submit-initial-world.js","helpers":["_common.js","_opening-session.js","semantic-model.js"],"timeoutMs":30000}}]
```
