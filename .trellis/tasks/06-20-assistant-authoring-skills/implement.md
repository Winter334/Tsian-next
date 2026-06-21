# Implement: Assistant Authoring Skills

## Execution Checklist

### Step 1: SKILL.md 内容常量
- [ ] `apps/platform-web/src/storage/local-assistant-files.ts` 顶部加 4 个字符串常量：`AGENT_AUTHORING_SKILL_MD`、`SKILL_AUTHORING_SKILL_MD`、`CARD_CONTENT_DRAFTING_SKILL_MD`、`VALIDATE_WORKSPACE_LAYOUT_JS`（用 `[...].join("\n")` 模式）。
- [ ] 扩展现有 `DEFAULT_FRAMEWORK_KNOWLEDGE_SKILL_MD`：补权限矩阵/skill 生命周期/助手 vs 运行时 agent 边界（不改 frontmatter）。
- [ ] agent-authoring SKILL.md：frontmatter + AgentConfig schema 速查 + 权限层级 + AGENT.md/SOUL.md 边界 + 生成流程 + 校验清单。
- [ ] skill-authoring SKILL.md：frontmatter + frontmatter 规范 + tsian-actions fence 模板 + executor 约束 + 生成流程 + 校验清单。
- [ ] card-content-drafting SKILL.md：frontmatter + 目录约定 + 起草流程 + 模板片段 + `tsian-actions` fence（validate_workspace_layout）。
- [ ] validate-workspace-layout.js：`tsian.workspace.list`/`read` 检查 README 存在性，返回 `{schema, ok, missing[], present[]}`，只读。
- [ ] **验证**：字符串内容肉眼 review frontmatter/fence 合规。

### Step 2: agent.json enabled + map 扩展
- [ ] `defaultAssistantConfig()` 的 `skills.enabled` 改为 `["framework-knowledge", "agent-authoring", "skill-authoring", "card-content-drafting"]`。
- [ ] `defaultLocalAssistantFileMap()` 加 4 个 key（3 SKILL.md + 1 script），framework-knowledge key 的 content 指向扩展后的常量。
- [ ] **验证**：`build:contracts && build:runtime-core` 通过。

### Step 3: load merge 逻辑（老用户兼容）
- [ ] `loadLocalAssistantFiles`：解析 stored map 后，检查 default map 的 key 是否缺失，缺则补入（不覆盖用户改过的），补后 persist。
- [ ] 复用 `saveLocalAssistantFiles` 合并写法或内联合并。
- [ ] **验证**：dev server 首次加载（清 Dexie）seed 全 4 skill；模拟老 map（缺新 key）加载后补齐。

### Step 4: 构建全绿
- [ ] `npm run build:contracts` 通过。
- [ ] `npm run build:runtime-core` 通过。
- [ ] `npm run build:web` 通过。
- [ ] **验证**：三绿。

### Step 5: dev server 冒烟
- [ ] `npm run dev:web`，`/#/workspace`（或资源管理器）见 `.tsian/local/assistant/skills/` 下 4 skill 目录 + card-content-drafting/scripts/。
- [ ] 读 agent.json 见 enabled 含 4 名。
- [ ] （无 key）`/#/assistant` 渲染——skill index 在会话初始化构建，但因无 key 不能发消息验 use_skill；确认无 build/渲染报错。
- [ ] frontmatter parse 不报错（`parseMarkdown` 在 index 构建时跑，若报错会进 `actionDeclarationErrors`——检查 card-content-drafting 的 fence 无 error）。
- [ ] **验证**：文件落地 + index 构建无错。

### Step 6: 收口
- [ ] spec 更新（`trellis-update-spec`：type-safety 记助手 skill seed + merge 策略；state-management 记 agent.json enabled 白名单约束）。
- [ ] commit（用户确认后）。
- [ ] 登记真实 LLM 往返 PV（use_skill → 注入 → run_script/写入 → /play 看反映，待 provider + key）。

## Validation Commands

```bash
npm run build:contracts
npm run build:runtime-core
npm run build:web
npm run dev:web   # 冒烟
```

## Rollback Points

- Step 1/2 后：`git checkout apps/platform-web/src/storage/local-assistant-files.ts`。
- 纯数据，无副作用回滚风险。

## Review Gates

- Step 1 后 review 4 SKILL.md frontmatter/fence 合规（executor.type/path/timeoutMs）。
- Step 3 后 review merge 逻辑只补不覆盖。
- Step 4 构建三绿是硬 gate。
