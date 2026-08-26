# 正文 Agent 原作文风学习：执行计划

## Ordered Checklist

1. 新增自举文风模块
   - 创建 `cards/沉浸阅读器.tsian-card/workspace/agents/storyteller/modules/文风/原作文风.md`。
   - 写入自包含的一次性学习提示，明确实际源正文读取方法、已读边界、输出要求、固定写入路径和同回合继续正文。
   - 不加入 frontmatter、状态标记、自动重学或模块组合说明。

2. 开放 Storyteller 写入能力
   - 修改 `cards/沉浸阅读器.tsian-card/workspace/agents/storyteller/agent.json`。
   - 启用 `workspace_write`。
   - 将 `workspaceAccess.level` 调整为 `2`。
   - 保持现有模块、Skill、上下文路径和其他配置不变。

3. 接通玩家正式回合的卡内容写入
   - 在 `apps/platform-web/src/platform-host/runtime-turn.ts` 引入 `WorkspaceFile` 类型和 `writeCardContentFileForActiveCard`。
   - 为 `card-content` 写入增加直接持久化分支。
   - 将直接写入结果同步进当前 staged workspace，保证同回合可读。
   - 保持 `platform-meta`、`save-runtime` 和删除路径现状。

4. 接通旁路调用的卡内容写入
   - 在 `apps/platform-web/src/platform-host/ai-invocation.ts` 引入 `writeCardContentFileForActiveCard`。
   - 增加与正式回合一致的 `card-content` 直写和 staged snapshot 同步。
   - 不改变 side invocation 的 save-runtime commit/checkpoint 语义。

5. 增加针对性回归验证
   - 扩展现有 `apps/platform-web/src/integration/assistant-runtime.smoke.test.ts` 测试夹具，使 level 2 Runtime Agent 能调用 `workspace_write` 覆盖卡内容文件。
   - 分别覆盖玩家正式回合与 `invokeAgent` 旁路调用。
   - 断言写入持久化到当前卡内容表，并且同一调用内后续读取可见新内容。
   - 保留 level 1 Agent 无权写 `card-content` 的既有权限边界。

6. 验证卡内容和平台代码
   - 检查 `agent.json` 可解析。
   - 检查新提示词自包含，且没有组合、校验、恢复或自动更新指令。
   - 运行针对性 Vitest smoke 测试。
   - 运行 `npm run build:web`，覆盖平台宿主 TypeScript 与打包边界。
   - 运行 `npm run repack:immersive-reader` 或等价卡打包命令，确认新模块进入产物。
   - 运行 `git diff --check` 并复核最终 diff。

## Validation Commands

```powershell
npm exec vitest run apps/platform-web/src/integration/assistant-runtime.smoke.test.ts
npm run build:web
npm run repack:immersive-reader
git diff --check
```

## Review Gates

- 新模块默认未出现在 `enabledModules` 中。
- `creation-guide.md` 的现有文风宏无需变化且能匹配新文件。
- 两条游戏 Agent 宿主路径都支持 `card-content` write，且没有放宽全局 access table。
- 代码没有新增文风专用格式、状态、互斥或恢复机制。
- 旧 Storyteller 模板未被顺手同步或重构。

## Rollback Points

- 文风功能可通过删除新模块并还原 Storyteller 权限配置撤回。
- 平台写入路由是独立的 `card-content` 分支，可分别从两处宿主适配器撤回。
- 不涉及数据库 schema 或存档格式迁移。
