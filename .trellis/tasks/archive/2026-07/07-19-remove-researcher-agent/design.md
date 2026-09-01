# Design: 移除资料员 Agent

## Architecture

`researcher` 是卡内容和默认 workspace 模板中的一个 Agent 资源集合，不是平台 runtime 的硬编码概念。本任务通过删除资源文件、移除 Agent contacts、清理 AI-facing 文本和默认模板 seeds 完成移除，不改平台 contracts 或 agent_call 机制。

## Boundaries

修改范围：

- 当前卡：`cards/沉浸阅读器.tsian-card/**`
- 默认 workspace 模板：`apps/platform-web/src/storage/workspace-templates/**`

不修改：

- `@tsian/contracts`
- agent runtime / agent_call 平台机制
- 历史文档：`docs/active/**`、`.trellis/tasks/archive/**`
- 既有用户存档的数据迁移 / 删除

## Data / Resource Flow

### 当前卡

1. 删除 `workspace/agents/researcher/`。
2. 从 `game-card.json` content manifest 移除 researcher 文件条目。
3. 从 stage-manager / world-architect contacts 移除 `researcher`。
4. 删除 AGENT.md / Skill / docs / README 中对 researcher / 资料员 / 资料检索的现行说明。
5. 保留其他 Agent 能力：stage-manager 仍可 call world-architect，world-architect 仍可 call stage-manager/storyteller。

### 默认模板

1. 删除 `agents/researcher.ts` 并从 `files.ts` 移除导入和展开。
2. 默认 workspace README / agents README 不再列 researcher。
3. 默认 save runtime 不再创建 `save/agents/researcher/notes.md`；`DEFAULT_SAVE_RUNTIME_UPGRADE_FILE_PATHS` 同步移除该 path。
4. storyteller / stage-manager / world-architect 默认配置中移除 researcher contact 和 “call 资料员” 文案。
5. docs templates 中不再把 researcher 描述为默认阵容或 frontier 消费者。

## AI-facing Cleanup Rule

对当前 prompt / docs / tool/skill descriptions，按“移除概念即零表面残留”处理：

- 不写“资料员已移除”。
- 不写“以前由资料员负责”。
- 不保留 `researcher` contact、skill appliesTo 或路径引用。
- 只描述替代后的现行能力：直接读已有上下文、使用专用工具、按需 call 仍存在的 Agent。

历史文档和归档 Trellis 任务允许保留旧 researcher 记录，因为它们不是当前 Agent 运行时上下文。

## Compatibility

- 新卡 / 新存档：不再生成 researcher。
- 既有存档：本任务不做破坏性删除迁移；旧存档中已有 researcher 文件不会被主动删除。
- 默认 workspace version：需要视模板变更决定是否 bump `DEFAULT_WORKSPACE_VERSION`。由于停止新增 `save/agents/researcher/notes.md` 只影响未来升级新增文件，且不删除旧存档文件，本任务可移除 upgrade path 而不做破坏性迁移。

## Validation

- grep 当前卡和 workspace templates，确认不再有 `researcher` / `资料员` / `资料检索` 残留。
- 构建：`npm run build:web`。
- 检查 game-card resource manifest 中无 researcher 文件条目。
