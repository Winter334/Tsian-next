# Implement — 实体字段局部更新工具

## Step 1: Add the shared Tool

- [x] 创建 `cards/沉浸阅读器.tsian-card/workspace/tools/update_entity/tool.json`。
- [x] 定义 `ref` + `patch` 输入 schema，并用简洁、自包含的 description 说明普通值、`$set`、`$unset`、`$append`、`$upsert`、`$remove`。
- [x] 创建 `run.js`，实现 ref/path 校验、危险 key 防护、JSON 深比较/克隆、patch 分类和对象递归。
- [x] 实现四类显式数组/删除操作及 changed path 收集。
- [x] 实现读取现有实体、id 校验、整次内存应用、no-op 短路和带 `expectedContent` 的写回。

Review gate:

- [x] 确认 Tool 不创建实体、不访问 `save/entities/` 之外路径、不修改根 id。
- [x] 确认任一校验/操作错误都发生在 write 之前。

## Step 2: Wire Agent visibility

- [x] `stage-manager/agent.json` 的显式 Tool 白名单加入 `tools/update_entity/tool.json`。
- [x] 保留 `world-architect` 当前空 enabled + disabled `roll_dice` 的共享 Tool 自动发现语义。
- [x] `storyteller/agent.json` 将 `update_entity` 加入 disabled，防止正文 Agent 获得实体写工具。

Review gate:

- [x] 按 registry 现有规则验证 stage-manager/world-architect 可见且 storyteller 不可见。

## Step 3: Update AI-facing guidance

- [x] 在 `stage-manager/AGENT.md` 添加已有实体小改优先使用 `update_entity` 的正向指引。
- [x] 在 `stage-manager/skills/回合后维护/SKILL.md` 将 entity 写入从通用整文件写入收束到 `update_entity`，其他文件仍使用现有 workspace 能力。
- [x] 在 `world-architect/AGENT.md` 写清已有实体局部更新与新实体/批量素材提交的边界。
- [x] 检查 `world-architect/skills/frontier推进/SKILL.md`；只有在现有文本会诱导用批量 action 覆盖已有实体时才补一条必要边界，避免重复说明。

Review gate:

- [x] AI-facing 文本只写 Agent 需要执行的动作与判断，不写开发动机。
- [x] 操作符详细规则只在 Tool description 保持单一权威。

## Step 4: Update package manifest

- [x] 在 `game-card.json.workspaceFiles` 加入：
  - `workspace/tools/update_entity/tool.json`
  - `workspace/tools/update_entity/run.js`
- [x] 同步所有修改后 workspace 文件的 size 元数据。
- [x] 确认 manifest 路径、内容文件与磁盘实际内容一致。

## Step 5: Validate behavior

JSON / syntax checks:

- [x] 解析 `tool.json`、三个相关 `agent.json` 与 `game-card.json`。
- [x] 用 `new Function("input", "tsian", "signal", runJs)` 编译 browser script body。

Mocked Tool cases:

- [x] 普通字段与嵌套字段 set。
- [x] `$set` 替换整个对象与数组。
- [x] `$unset` 删除已有字段及缺失字段 no-op。
- [x] `$append` 追加 scalar/object，并验证重复调用不会重复完全相同值。
- [x] `$upsert` 的 0 匹配新增、1 匹配浅合并、多匹配整次失败；同一调用内先改后还原时不误报 changed path。
- [x] `$remove` 的 scalar 精确匹配、object 条件匹配、缺失数组 no-op。
- [x] 中间对象缺失时创建；已有值类型冲突时报错。
- [x] 未涉及旧字段和旧数组项完整保留。
- [x] 空 patch/no-op 不调用 write。
- [x] 实际写入传入读取到的 `expectedContent`。
- [x] 非法 ref、缺失文件、非法 JSON、id 不一致、根 id set/unset、危险 key、裸数组、未知/混合操作符均失败且不写。

Repository checks:

```bash
git diff --check
```

- [x] 确认 diff 仅涉及当前卡与本任务 Trellis artifacts；不涉及 `apps/platform-web/src/storage/workspace-templates/**`。

## Rollback point

若 Tool 行为验证失败，先回滚 Agent 可见性和提示词引用，再移除共享 Tool 与 manifest 条目；本功能不包含存档迁移，无需数据回滚。
