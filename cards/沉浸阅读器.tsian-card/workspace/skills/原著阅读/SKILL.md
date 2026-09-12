---
name: 原著阅读
appliesTo:
  - storyteller
  - world-architect
description: 定位和阅读相关连续原文、必要原剧情；不依赖 frontier，不需要拼物理路径。
---

# 原著阅读

read_source 按 startIndex（1 起）和 offset（章内 UTF-16 字符偏移，默认 0）读取连续原文；省略位置时用写手书签，否则从第一章开始。返回章节范围、text、truncated 和 next，按 next 补读可无遗漏衔接。maxCharacters 默认 8000，上限 12000；输出不等于全章时必须注意截断。
locate_source 用 query 查章节标题和正文，返回 startIndex、offset、preview；nextStartIndex 非空时仍有章节未查，未命中不等于全书不存在。可向任意章节定位，作者可看必要前后剧情。
写手（包括访谈）读到适合当前创作的片段时用 remember:true 保存这次读取的起点，供下次调用自动带入原文；这是检索书签，不是剧情进度，不修改本局事实。架构师阅读时不传 remember。
原文是世界/人物/文风及默认因果的依据；原著未来不是本局历史。人物不能凭作者知道的未来行动，按视角和剧情时机揭示。不要求每轮读完整书、写大纲或回归原著。


```json tsian-actions
[{"name":"read_source","description":"按章节序号与章内字符偏移读取连续原文；返回可继续的精确位置。remember 仅用于写手保存检索书签，不推进本局。","inputSchema":{"type":"object","additionalProperties":false,"properties":{"startIndex":{"type":"integer","minimum":1,"maximum":999999},"offset":{"type":"integer","minimum":0,"maximum":10000000},"maxCharacters":{"type":"integer","minimum":500,"maximum":12000},"remember":{"type":"boolean"}},"required":[]},"outputSchema":{"type":"object"},"executor":{"type":"browser_script","helpers":["/agents/world-architect/skills/开局建模/scripts/_common.js","reader-core.js"],"timeoutMs":30000,"path":"scripts/read-source.js"}},{"name":"locate_source","description":"按标题或正文关键词定位，返回章节和章内位置；可分页查后续章节，不限制未来。","inputSchema":{"type":"object","additionalProperties":false,"properties":{"query":{"type":"string","minLength":1,"maxLength":100},"startIndex":{"type":"integer","minimum":1,"maximum":999999},"chapterLimit":{"type":"integer","minimum":1,"maximum":50}},"required":["query"]},"outputSchema":{"type":"object"},"executor":{"type":"browser_script","helpers":["/agents/world-architect/skills/开局建模/scripts/_common.js","reader-core.js"],"timeoutMs":30000,"path":"scripts/locate-source.js"}}]
```
