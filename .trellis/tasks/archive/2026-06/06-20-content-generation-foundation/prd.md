# Content Generation Foundation

## Goal

把出厂体验从"空壳脚手架"升级为"一键创建可游玩模板卡 + 助手可创作内容"的内容生成基座。三条线咬合成正反馈闭环：轻量通用前端让 `/play` 不再是死路 → 助手创作 Skill 在卡工作区生成内容 → 前端能读能玩，同时压测最近改的 agent-runtime（过程可视化 / 消息复制编辑 / 跨 turn 持久化）。

## Parent Role

本任务是整合容器，不直接承担实现。它 owns：

- 跨子任务的需求集与任务地图。
- 跨子任务的整合验收标准（子任务各自验收之外的端到端闭环）。
- 子任务边界与执行顺序。

## Task Map

| 子任务 | Slug | 职责 | 复杂度 |
|---|---|---|---|
| 子1 | `06-20-default-card-and-lightweight-frontend` | 轻量通用 AIRP 文字前端（3 文件 packaged）+ 内置卡定位为模板 + 卡库"创建"入口 | 复杂 — 已完成 |
| 子4 | `06-21-content-files-per-file-table` | contentFiles 内嵌数组迁移到 per-file Dexie 表，消除整卡重写 | 复杂（prd+design+implement） |
| 子5 | `06-21-workspace-storage-volume-abstraction` | WorkspaceVolume 接口 + 4 后端包 volume + 3 路由点收敛为单一 dispatch + card-frontend scope | 复杂（prd+design+implement） |
| 子3 | `06-21-game-card-data-fileification` | 全数据文件化（game-card.json manifest + 前端可见可编辑）+ 内置卡退化为不可见模板 + fallback 改自动创建默认卡 | 复杂（prd+design+implement） |
| 子2 | `06-20-assistant-authoring-skills` | 助手创作 Skills 套件（agent / skill / 卡内容草稿 / 框架知识增强） | 中等（prd+design+implement） |

执行顺序：**子1（完成）→ 子4 → 子5 → 子3 → 子2**。

依赖链：
- 子4 → 子5（强）：子5 的 `CardContentVolume` 依赖子4 产出的 per-file API。
- 子5 → 子3（接口）：子3 的 `CardFrontendVolume`/`ManifestVolume` 实现插入子5 的统一 dispatch，不碰路由点。
- 子3 → 子2（能力）：子2 创作 skills 能管理卡的一切，依赖子3 把前端+manifest 文件化。

子4/子5 是存储重构地基（解决"不同目录路由到不同地方"的碎片化 + 整卡重写），子3 在地基上做全数据文件化，子2 在文件化能力上做创作 skills。

## Inherited Intent

继承并取代现有 planning 任务 `06-15-default-packaged-game-frontend`（PRD-only，已归档）。其原意图——"做一个 packaged 默认游戏前端，绑空白卡，`/play` 走 iframe bridge"——由子1 完整覆盖并扩展（加了模板卡 + 创建入口）。

## Cross-Child Acceptance Criteria

子1、子2 各自验收通过之外，父任务独有的端到端验收：

- [ ] 在卡库点"创建"生成一张绑定轻量前端的本地卡，并自动切为活跃卡。
- [ ] 该卡 `/play` 能加载前端、完成 postMessage 握手、渲染 snapshot（无 key 验加载与空状态；有 key 验发消息 → 流式回复 → 内容落盘）。
- [ ] 助手能用创作 Skill 往该卡工作区写内容（有 key 验 use_skill → run_script/写入；无 key 验 skill 文件落地 + agent.json enabled 正确 + 出现在 Skill Index）。
- [ ] 助手写入的内容（如 `world/canon.md`、`agents/<id>/agent.json`）能被前端/工作区读到（文件系统可视化验证）。
- [ ] `npm run build:web` 通过。
- [ ] 真实 LLM 往返验证登记 PV，待 provider + API key 环境就绪，不阻塞任务收口。

## Constraints

- 不扩 `platform.runAction`（create-card 类 action 后续再考虑；创建走 UI + 现有 storage 原语）。
- 不动 `@tsian/contracts`（`bridge.ts` / `game-card.ts` / `runtime.ts` 不改）。
- 不动 Service Worker（`public/tsian-game-card-frontend-sw.js`）。
- 不动 agent-runtime 代码（registry / workspace-tools / permissions / browser-skill-script-executor）。
- Skills 是纯工作区内容工作，落地靠助手 level-4 `workspace_write`（SDK 只放行 `workspace.*`）。
- 前端是 3 个静态文件，无构建管线。

## Out Of Scope

- 平台级建卡 / 导入 / 切卡 platform action（后续任务）。
- 组件化富前端（本阶段做轻量三文件，后续可加组件支持）。
- 运行时 agent（master/narrative/memory）的 skills（本任务只做桌面助手 skill）。
- 真实 LLM 往返（需用户配 provider + API key）。

## Dependencies

- 子2 的端到端验证依赖子1 产出的可游玩卡。
