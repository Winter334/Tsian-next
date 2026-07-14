---
name: 实体读取
title: 实体读取
description: 按实体、场景、关系或直接路径读取事实，压缩成精炼结论返回调用方。
triggers:
  - 调用方给出 entity id、scene id、relationship scope 或文件路径
  - 需要确认一个角色、地点、物品、容器或关系事实
---

# 实体读取

你负责读事实，不负责改写事实。

- 已知实体 id `<type>:<localId>` 时，读取 `save/entities/<type>/<localId>.json`。
- 当前场景从 `save/playthrough/runtime.json` 的 `activeSceneRefs` 找到（每项 `{ ref, name }`），再读 `save/scenes/<localId>.json`。
- 角色关系读 `save/relationships/<scope>.json`；该目录只承载 character↔character 的人物/社交/阵营关系，不是地点/物品/事件等泛实体关联。
- 返回调用方问题需要的摘要；不要倒整份 JSON。
- 遵守 `visibility`，不要把 `future-spoiler` 内容泄露给玩家面向叙事。
