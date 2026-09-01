# Design: Agent Runtime 平台方向文档清理

## Architecture Direction

新的 active 方向文档应把 Tsian 定义为 Agent-Orchestrated AIRP Runtime 平台，而不是 workflow-as-system 平台。

核心边界：

- Platform：包加载、沙箱、桥 API、模型调用、权限、通用存储、存档实例生命周期、导入导出。
- Agent Runtime：主控 Agent、专业 Agent、通用工具、AIRP 回合组织、运行时数据产出。
- Frontend Package：iframe 或类似沙箱中的游戏界面，按自身约定解释 runtime 产出的数据并渲染 UI。
- Content / Mod：世界观、玩法规则、agent 配置、初始数据、可选前端/运行时绑定。
- Save Instance：一次 AIRP 会话 / 世界实例的数据容器，类似网页 AI 聊天会话记录；平台不理解其内部玩法语义。

## Document Boundary

### Keep And Rewrite

- `docs/active/airp-workflow-platform-direction.md`
  - 直接覆盖为当前 Agent Runtime 方向文档。
  - 文件名保留，避免入口链接 churn；内容不再保留 workflow-as-system 当前权威文本。

- `docs/active/current-state-handoff.md`
  - 保留当前实现状态和代码入口。
  - 明确当前代码中的 workflow/prompt-engine 是原型遗留，不代表未来主线。
  - 更新下一步建议为文档方向落地和 Agent Runtime 规划。

- `docs/active/deferred-work.md`
  - 保留作为 active 的“暂缓/退场登记”入口。
  - 新增旧 workflow editor、SillyTavern prompt-engine、可视 DAG workflow、通用 renderer/schema resource 等方向退场或降级说明。

- `docs/active/README.md`
  - 更新阅读顺序和维护规则。

- `docs/README.md`
  - 更新全局文档指南和当前稳定主干。

- `README.md`
  - 更新项目入口介绍，避免仓库首页仍停留在旧 workflow-as-system 或旧应用边界口径。

### Delete Or Heavily Slim

- `docs/reference/*.md`
  - 这些是早期骨架文档，已经不作为 active guidance。
  - 继续保留会在语义搜索中混入旧方向。
  - 推荐删除具体骨架文件，仅按需保留 `docs/reference/README.md` 说明旧 reference 已清理，历史请查 Trellis tasks / git history。

- `docs/archive/2026-06-05-workflow-as-system/*.md`
  - 这些记录旧 workflow-as-system 阶段方向，与新 active 方向冲突。
  - 用户已确认任务记录足够承载历史。
  - 推荐删除该目录下具体历史文档，避免检索污染。

## Compatibility Notes

- 代码仍然保留 workflow-engine、prompt-engine、workflow editor 等原型实现，文档只改变规划权威来源。
- 新文档不承诺立即删除代码，不承诺迁移 `interaction.sendMessage`。
- 旧实现可作为短期参考或回归对照，但新功能规划不再以适配旧 workflow / prompt-engine 为目标。

## Search Hygiene

本任务的核心质量目标是减少语义检索中的冲突答案。因此文档清理不应只在旧文档顶部加一行“已过期”，因为全文仍会被检索召回。对明显过时且已有 task/git 历史承载的材料，删除优于保留。

## Trade-Offs

- 删除旧文档会降低离线阅读历史设计的便利性，但 Trellis task 记录、git history 和 archived task PRD 已经能解释旧实现来源。
- 保留旧文档会降低当前方向检索质量，尤其是 workflow、prompt preset、schema resource、renderer adapter、SillyTavern 相关关键词。

## Rollback

- 如果清理后需要恢复某份历史文档，可从 git history 或对应 archived Trellis task 中取回。
- 如果新方向文档后续被改名，可先维护同名文件作为入口，再更新根 `README.md`、`docs/README.md` 和 `docs/active/README.md`。
