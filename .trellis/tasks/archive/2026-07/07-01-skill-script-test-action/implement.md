# Implement — Skill 脚本测试工具 + 错误信息透传

## Step 1: errorPayload 错误分层（`browser-skill-script-executor.ts`）

- [ ] Worker 源码内 `errorPayload(error)` 改造：区分 SyntaxError / 有 .code 的自定义错误 / 普通 Error，各自返回独立 code + stack
- [ ] 主线程 `script-result` 错误处理（line 778-794）透传 `stack` 字段
- [ ] `worker.onerror`（line 732-742）补充 `event.error.stack`（截断 1000）
- [ ] 验证：`npm run build --workspace platform-web` 通过

## Step 2: 注册工具名 + 权限（`workspace-tools-types.ts` + `permissions.ts`）

- [ ] `RUNTIME_WORKSPACE_TOOL_NAMES` 加 `testSkillScript: "test_skill_script"`
- [ ] `AGENT_PLATFORM_TOOL_NAMES` 加 `testSkillScript: "test_skill_script"`
- [ ] `RuntimeWorkspaceToolExecutionContext` 加 `runTestSkillScript?` 能力注入字段
- [ ] 验证：`npm run build --workspace contracts` + `npm run build --workspace platform-web` 通过

## Step 3: 工具 schema（`tool-schemas.ts`）

- [ ] 定义 `testSkillScriptSchema`（name/description/parameters）
- [ ] 在 schema 注入逻辑中，当 `AGENT_PLATFORM_TOOL_NAMES.testSkillScript` 被启用时 push schema
- [ ] description 面向 agent：说明用途、错误码含义、调试引导
- [ ] 验证：`npm run build --workspace platform-web` 通过

## Step 4: dispatch + 参数校验（`workspace-tools.ts`）

- [ ] `normalizeTestSkillScriptArguments(arguments)` 手写校验：skillName/actionName 非空 string、input 是 object
- [ ] `executeRuntimeWorkspaceToolCalls` 加 `test_skill_script` 分支：调 `context.runTestSkillScript`
- [ ] 无 `runTestSkillScript` 时返回 `TEST_SKILL_SCRIPT_UNAVAILABLE`
- [ ] 验证：`npm run build --workspace platform-web` 通过

## Step 5: runTestSkillScript 实现（`platform-host/index.ts`）

- [ ] 实现 `runTestSkillScript(input)`：从 workspaceFiles 定位 Skill → 解析 action → 校验 executor → 调 `runBrowserScript`
- [ ] Skill 定位：遍历 `skills/*/SKILL.md`，解析 frontmatter name 匹配 skillName
- [ ] Action 解析：复用现有 `buildSkillRegistry` / skill detail loading 逻辑解析 tsian-actions block
- [ ] 校验：executor.type === "browser_script"、scriptPath 在 skill 目录内、文件存在
- [ ] 错误码：`SKILL_NOT_FOUND` / `ACTION_NOT_FOUND` / `ACTION_NOT_BROWSER_SCRIPT` / `BROWSER_SCRIPT_NOT_FOUND`
- [ ] 在 `sendMessage` 和 `invokeAgent` 的 `runAgentRuntimeTurn` capabilities 中注入 `runTestSkillScript`
- [ ] 验证：`npm run build --workspace platform-web` 通过

## Step 6: 助手默认配置（`local-assistant-files.ts`）

- [ ] `defaultAssistantConfig.platformTools.enabled` 加入 `"test_skill_script"`
- [ ] 更新 `local-assistant-files.ts` 中 platformTools 文档（VALID_PLATFORM_TOOLS 描述）
- [ ] 验证：`npm run build --workspace platform-web` 通过

## Step 7: 全量构建 + 手动验证

- [ ] `npm run build --workspace contracts` 通过
- [ ] `npm run build --workspace platform-web` 通过
- [ ] 检查现有 `run_script` 错误返回不受破坏（errorPayload 向后兼容：有 .code 的错误仍透传原始 code）

## Validation Commands

```bash
npm run build --workspace contracts
npm run build --workspace platform-web
```

## 回滚点

每步独立 commit。失败 `git checkout` 回上一步。Step 1（errorPayload）和 Step 2-6（test_skill_script）可以独立回滚——errorPayload 改造对现有 run_script 自动生效，不依赖 test_skill_script 工具。

## 完成后

- 助手 agent 可在浏览器中用 `test_skill_script` 测试 opening-initialization 的三个 action，定位实际失败原因
- 根据真实错误信息决定后续是否需要 SDK 扩展（`tsian.llm.call` 等）
