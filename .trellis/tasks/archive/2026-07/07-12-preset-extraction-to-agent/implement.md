# Implement: 从酒馆预设提取写作增强与越狱技术到 AIRP Agent

## 执行顺序

按依赖关系分 5 个阶段。每阶段结束后有验证点。

### Phase A: Contracts + Runtime 基础（先打通管道）

- [ ] A1. `packages/contracts/src/runtime.ts`：`AgentContextEntry` 加 `prefillFile?: WorkspaceFile`
- [ ] A2. `apps/platform-web/src/agent-runtime/context.ts`：加 `PREFILL_FILE_NAME` 常量，`assembleAgentContext` 读取 PREFILL.md，赋值 `entry.prefillFile`
- [ ] A3. `apps/platform-web/src/agent-runtime/index.ts`：`buildEntryAgentMessages` 在 afterInputInjection 末尾追加 assistant 消息（`context.prefillFile` 存在时）。位置在序列最后一条，不破坏 system+history+workspace context 稳定前缀缓存；PREFILL.md 不落盘不进 context.json，不污染下一轮 history 前缀。详见 design.md §9 缓存命中分析。
- [ ] A4. 验证：`pnpm --filter @tsian/contracts build` + `pnpm --filter @tsian/platform-web build` 通过

### Phase B: 写作质量技能（内容，无依赖）

- [ ] B1. workspace-templates.ts：新增 `LIVING_CHARACTER_SKILL_MD` 常量（活人感基准 SKILL.md）
- [ ] B2. workspace-templates.ts：新增 `KILL_CLICHE_REF_MD` 常量（references/kill-cliche.md，来源预设 `46dbedd7`）
- [ ] B3. workspace-templates.ts：新增 `PERSONA_DEPTH_REF_MD` 常量（references/persona-depth.md，来源预设 `ff1ff3d1`）
- [ ] B4. workspace-templates.ts：新增 `NARRATIVE_PROGRESS_SKILL_MD` 常量（叙事推进 SKILL.md，来源预设 `f6d5d3fb`）
- [ ] B5. workspace-templates.ts：在文件数组中注册 4 个新文件条目

### Phase C: NSFW 指导技能

- [ ] C1. workspace-templates.ts：新增 `ADULT_SCENE_SKILL_MD` 常量（成人场景指导 SKILL.md）
- [ ] C2. workspace-templates.ts：新增 `ADULT_STAGING_REF_MD` 常量（references/staging.md，来源预设 H-Guide `a6e5b2ca`）
- [ ] C3. workspace-templates.ts：新增 `ADULT_ELEMENTS_REF_MD` 常量（references/elements.md，来源预设 Sex_Guide `eb651274`）
- [ ] C4. workspace-templates.ts：新增 `ADULT_ENTRY_PACE_REF_MD` 常量（references/entry-and-pace.md，来源预设 `a01febbd`+`745611c7`+`318fd753`）
- [ ] C5. workspace-templates.ts：在文件数组中注册 4 个新文件条目

### Phase D: Agent 定义改写（SOUL/AGENT/PREFILL/agent.json）

- [ ] D1. workspace-templates.ts：重写 `storyteller/SOUL.md` content（身份认同 + 正面强化，红线切除）
- [ ] D2. workspace-templates.ts：扩充 `storyteller/AGENT.md` content（新增创作纪律段）
- [ ] D3. workspace-templates.ts：新增 `STORYTELLER_PREFILL_MD` 常量（PREFILL.md，红线切除后的 prefill 示范）
- [ ] D4. workspace-templates.ts：更新 `storyteller/agent.json` content（skills.enabled +3）
- [ ] D5. workspace-templates.ts：在文件数组中注册 `agents/storyteller/PREFILL.md`

### Phase E: stage-manager 流程纪律 + 默认卡文件

- [ ] E1. workspace-templates.ts：扩充 `stage-manager/AGENT.md` content（新增记忆格式 + 伏笔追踪段）
- [ ] E2. workspace-templates.ts：更新 `stage-manager/agent.json` content（contextPaths +1）
- [ ] E3. workspace-templates.ts：新增 `save/memory/seeds.md` 文件条目

### Phase F: 验证

- [ ] F1. 红线扫描：`rg -i "未成年|少年|少女|萝莉|正太|儿童|小孩|幼|child|minor|underage|loli" apps/platform-web/src/storage/workspace-templates.ts` → 命中数 0
- [ ] F2. 构建：`pnpm --filter @tsian/contracts build && pnpm --filter @tsian/platform-web build` 通过
- [ ] F3. 检查 workspace-templates.ts 文件数组：新文件条目 path 无重复，storyteller/stage-manager 的 agent.json skills/contextPaths 正确
- [ ] F4. 缓存边界确认：PREFILL.md 注入点在 `...afterInputInjection` 之后、`return` 数组末尾；不落盘不进 context.json（与 injection 同理，不写入 turn history）

## 验证命令

```bash
# contracts build
cd packages/contracts && pnpm build

# platform-web build
cd apps/platform-web && pnpm build

# 红线扫描
rg -i "未成年|少年|少女|萝莉|正太|儿童|小孩|幼|child|minor|underage|loli" apps/platform-web/src/storage/workspace-templates.ts

# 文件条目完整性
rg "path:.*storyteller" apps/platform-web/src/storage/workspace-templates.ts
rg "path:.*stage-manager" apps/platform-web/src/storage/workspace-templates.ts
```

## 回滚点

- Phase A 完成后：PREFILL.md 机制已就绪但无 Agent 使用它，不影响现有行为
- Phase B-E 完成后：全部内容在 workspace-templates.ts 中，构建验证通过即可
- 如构建失败：先检查 string literal 的 `text([...])` 格式、转义字符、agent.json 的 JSON 合法性
