# Implement：消息序列声明机制

## 执行顺序

### Phase 1：契约层 + 解析层

- [ ] 1.1 `packages/contracts/src/runtime.ts`：新增 `ContextPathPosition` 类型；`ContextPathObject` 加 `position` 字段；`ContextInjection` 加 `position` 字段；`AgentContextEntry` 加 `contextInjectionsByPosition` 字段
- [ ] 1.2 `apps/platform-web/src/agent-runtime/registry.ts`：`parseContextPathEntries` 解析 position 字段，验证合法值，默认 `workspace-context`
- [ ] 1.3 `apps/platform-web/src/storage/local-assistant-files.ts`：`validateAgentConfig` 校验 position 合法值

### Phase 2：编译层

- [ ] 2.1 `apps/platform-web/src/agent-runtime/context.ts`：`assembleAgentContext` 按 position 分组到 `contextInjectionsByPosition`；`contextInjections` = workspace-context 组（向后兼容）
- [ ] 2.2 `context.ts`：PREFILL.md 兼容迁移——tail 组为空且 PREFILL.md 存在时自动创建 tail 注入

### Phase 3：消息构建层 + 整合器

- [ ] 3.1 `apps/platform-web/src/agent-runtime/index.ts`：新增 `contextInjectionsToMessages` 辅助函数（用 `<!-- source: xxx -->` 注释前缀）
- [ ] 3.2 `index.ts`：改造 `buildEntryAgentMessages` 按 position 组装消息序列（逐条产出，不合并）
- [ ] 3.3 `index.ts`：改造 `buildAgentContextMessages_split` — 元信息消息保留在 workspace-context 区域开头，注入消息从 workspace-context 组取
- [ ] 3.4 `index.ts`：改造 `buildDelegatedAgentMessages` 支持 position 注入
- [ ] 3.5 `index.ts`：改造 `locateHistorySpan` — 扫描跳过 `<!-- source:` 开头的 before-history 注入消息找 start
- [ ] 3.6 `index.ts`：新增 `mergeConsecutiveRoleMessages` 整合器 — 合并连续相同 role 消息，纯换行拼接内容，不加自动标签（标签由作者在 contextPath 内容里显式写，与酒馆预设一致）
- [ ] 3.7 `index.ts`：在 native/text 两个工具循环中，每轮调用 model API 前对当前 messages 数组过整合器

### Phase 4：storyteller 配置还原

- [ ] 4.1 `workspace-templates.ts`：新建 `STORYTELLER_PREFILL_ACCEPT_MD` 常量（从现有 `STORYTELLER_PREFILL_MD` 拆出越狱确认复述）
- [ ] 4.2 `workspace-templates.ts`：新建 `STORYTELLER_COT_TEMPLATE_MD` 常量（COT 问题框架 + 输出格式硬模板，从原预设 GLM Core + 自由CoT 提取，适配 Tsian `[[选项]]` 约定）
- [ ] 4.3 `workspace-templates.ts`：storyteller agent.json contextPaths 改造（before-history / after-input / tail 三层声明）
- [ ] 4.4 `workspace-templates.ts`：新增文件条目 `agents/storyteller/prefill-accept.md` 和 `agents/storyteller/cot-template.md`
- [ ] 4.5 `workspace-templates.ts`：删除 `agents/storyteller/PREFILL.md` 文件条目

### Phase 5：验证

- [ ] 5.1 类型检查通过（`pnpm tsc` 或等价）
- [ ] 5.2 现有 agent 无 position 声明时消息序列不变（向后兼容验证）
- [ ] 5.3 locateHistorySpan 三种场景验证：无 before-history / 有 before-history / 有 assistant before-history
- [ ] 5.4 整合器验证：连续相同 role 正确合并、纯换行拼接保留原始标签结构、不连续 role 不合并
- [ ] 5.5 整合器不影响工具循环内部 splice-replace（验证整合只在发送前发生）
- [ ] 5.6 storyteller 消息序列还原原预设 GLM 路径结构
- [ ] 5.7 上下文压缩在有 before-history 注入时正确 splice-replace

## 验证命令

```bash
# 类型检查
cd F:/workspace/Tsian && pnpm tsc --noEmit

# Lint
cd F:/workspace/Tsian && pnpm lint

# 测试（如有相关测试）
cd F:/workspace/Tsian && pnpm test
```

## 风险文件

| 文件 | 风险 | 回滚点 |
|---|---|---|
| `index.ts` locateHistorySpan | start 计算错误导致压缩 splice 错位 | 保留旧 `start = 1` 逻辑作为 fallback |
| `index.ts` mergeConsecutiveRoleMessages | 合并逻辑错误导致消息内容丢失或标签错误 | 整合器是独立函数，可移除调用回退到不合并 |
| `index.ts` 整合器调用时机 | 在 splice-replace 后忘记整合或重复整合 | 整合器只在 callModel/callModelNative 调用前执行，工具循环内部不调用 |
| `context.ts` PREFILL.md 兼容 | 旧存档 tail 行为变化 | 兼容读取优先级：无 tail contextPath 才用 PREFILL.md |
| `workspace-templates.ts` storyteller 配置 | 现有存档 PREFILL.md 行为变化 | PREFILL.md 兼容读取兜底 |

## 回滚策略

- 契约层改动是纯增量（新字段可选），回滚只需移除新字段
- 消息构建层保留旧路径作为 fallback：如果 `contextInjectionsByPosition` 不存在（旧存档），走现有 `contextInjections` + `prefillFile` 逻辑
- storyteller 配置改动可通过 git revert 单独回滚，不影响平台代码
