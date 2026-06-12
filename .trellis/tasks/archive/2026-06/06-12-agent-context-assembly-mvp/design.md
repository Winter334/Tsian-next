# Agent 上下文组装 MVP Design

## Architecture

本任务在现有 Runtime Workspace 和 registry 基础上增加一个只读组装层：

```text
WorkspaceFile[]
  -> buildAgentRegistry(files)
  -> buildSkillRegistry(files, { agentId, includeShared: true, includeLocal: true })
  -> assembleAgentContext(files, agentId)
  -> platform bridge query: agent-context
```

组装层应放在 `apps/platform-web/src/agent-runtime/` 下，与 `registry.ts` 同层或复用其中能力。它不访问 Dexie，不调用模型，不写 workspace，只消费传入的 `WorkspaceFile[]`。这样它可以用内存 fixture 验证，也能被未来 runtime turn、debug UI、`agent.call` 复用。

## Contracts

在 `packages/contracts/src/runtime.ts` 新增类似以下类型：

```ts
export interface AgentContextEntry {
  agent: AgentRegistryEntry
  agentFile: WorkspaceFile
  notesFile?: WorkspaceFile
  sessionFile?: WorkspaceFile
  skillIndex: SkillRegistryEntry[]
  contextFiles: WorkspaceFile[]
  missingContextPaths: string[]
}
```

命名可在实现时按现有风格微调，但语义保持：

- `agent` 是轻量 registry entry，调用方可看 id/title/summary/contacts/defaultSkills/contextPaths。
- `agentFile` 是完整 `AGENT.md` 正文，用于后续 prompt assembly。
- `notesFile` 和 `sessionFile` 是 Agent 自己目录下的约定文件；不存在时省略。
- `skillIndex` 是轻量索引，不含 `SKILL.md` detail。
- `contextFiles` 是 `contextPaths` 中实际存在的 workspace files。
- `missingContextPaths` 是声明了但不存在或非法的 path。

## Agent Resolution

MVP 优先支持按 `agentId` 解析：

1. 通过 `buildAgentRegistry(files)` 找到 `entry.id === agentId`。
2. 找到对应 `entry.path` 的 `WorkspaceFile` 作为 `agentFile`。
3. 从 `entry.path` 推导 agent directory，例如 `agents/master/AGENT.md` -> `agents/master`。

如果未来存在 id 冲突，可再扩展 `path` 查询。当前 registry 已按 path 稳定排序，本任务暂不处理复杂冲突策略。

## Context Path Handling

`contextPaths` 来自 `AGENT.md` frontmatter。组装时：

- 使用 workspace storage 同等路径规范做安全思路，但 helper 内部不应抛出到 bridge。
- path 精确匹配 `WorkspaceFile.path` 才进入 `contextFiles`。
- 缺失或不合法 path 进入 `missingContextPaths`。
- 不读取目录，不做通配，不隐式包含 README 之外的额外文件。
- 保持 `AGENT.md` 中声明顺序，方便 prompt 后续稳定。

## Skill Visibility

Agent 上下文中的 `skillIndex` 调用现有 `buildSkillRegistry(files, { agentId })` 语义：

- shared skills 可见；
- 该 agent 的 local skills 可见；
- 其它 agent 的 local skills 不可见；
- 不加载 `skill-detail`。

这符合渐进披露原则：常驻上下文只有 summary/triggers/appliesTo，Agent 判断需要后再加载详情。

## Bridge Query

在 `apps/platform-web/src/platform-host/index.ts` 中增加：

```ts
resource: "agent-context"
params: { agentId: string }
```

行为：

- 无 active save -> `{ items: [] }`
- agentId 非空字符串才继续，否则 `{ items: [] }`
- 未找到 agent -> `{ items: [] }`
- 找到则返回单个 `AgentContextEntry`

异常处理与 `skill-detail` 类似，倾向于温和失败返回空 items，避免 debug/query 破坏主流程。

## Compatibility

- 不改变 `interaction.sendMessage`，所以当前 AIRP 回合行为、AI debug、checkpoint、snapshot、stateRecords 均应保持。
- 新类型是增量导出，不破坏现有 contracts consumer。
- 默认 workspace 文件已经包含 `contextPaths`，因此新建存档可直接验证。

## Documentation

更新 active docs 中过期实现状态：

- `docs/active/current-state-handoff.md`
- `docs/active/agent-framework-runtime-workspace-direction.md` 第 13 节或等价位置

文档应说明 Runtime Workspace、Agent/Skill registry、skill detail loading 已实现，Agent context assembly 是当前新增能力；action executor、agent.call、运行链迁移仍未实现。

## Rollback

回滚方式简单：

- 删除新增 contract 类型；
- 删除新增 context helper；
- 删除 `agent-context` bridge query；
- 恢复文档更新。

因为不改变 turn execution，风险集中在新 query 和类型导出上。
