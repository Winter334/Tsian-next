# Implement：stage-manager 维护优化第二轮

## 执行顺序

### Phase 1：readEntity 全文返回

- [ ] 1.1 `workspace-templates.ts` run.js：`readEntityBrief` 函数改名为 `readEntity`，返回完整 entity JSON + `ref` 字段。fallback `{ref, name: ref}` 保持。
- [ ] 1.2 run.js 调用点：`const brief = await readEntityBrief(...)` 改为 `const entity = await readEntity(...)`，`entities.push(brief)` 改为 `entities.push(entity)`。
- [ ] 1.3 run.js 注释 + tool.json description：措辞从"entity 摘要"改为"entity（完整）"。

### Phase 2：memory 文件路径明确 + records.md + 注入授权

- [ ] 2.1 `workspace-templates.ts` 新增 `save/memory/records.md` 文件条目（header + 格式说明）。
- [ ] 2.2 `workspace-templates.ts` stage-manager agent.json contextPaths 加 `{ path: "save/memory/records.md", role: "user", position: "workspace-context" }`（放在 seeds.md 之后）。
- [ ] 2.3 `workspace-templates.ts` AGENT.md "记忆格式"段：措辞改为"基于上下文已注入的 `save/memory/records.md` 内容，按标签记忆格式追加"。
- [ ] 2.4 `workspace-templates.ts` AGENT.md "伏笔追踪"段：措辞改为"基于上下文已注入的 `save/memory/seeds.md` 内容维护伏笔"。
- [ ] 2.5 `workspace-templates.ts` SKILL.md memory 维护段（如有）：同步措辞指向 records.md + 注入授权。
- [ ] 2.6 stage-manager notes.md contextPaths 列表自动更新（由 assembleAgentContext 运行时生成，无需手改模板——确认 notes.md 模板不含硬编码 contextPaths 列表）。

### Phase 3：验证

- [ ] 3.1 `npm run build:web`
- [ ] 3.2 grep 零禁令：stage-manager AGENT.md/SKILL 不含"不要 read records.md / seeds.md"之类禁令。
- [ ] 3.3 grep 注入授权：stage-manager AGENT.md/SKILL 含"基于上下文已注入的 records.md / seeds.md"。
- [ ] 3.4 grep readEntityBrief：run.js 无 `readEntityBrief` 残留。
- [ ] 3.5 readEntity 返回形态验证：成功时含完整 entity 字段，失败时 fallback `{ref, name: ref}`。

## 验证命令

```bash
cd F:/workspace/Tsian && npm run build:web
cd F:/workspace/Tsian && rg -n "readEntityBrief" apps/platform-web/src/storage/workspace-templates.ts
cd F:/workspace/Tsian && rg -n "不要.*read.*records|不要.*read.*seeds" apps/platform-web/src/storage/workspace-templates.ts
cd F:/workspace/Tsian && rg -n "基于上下文已注入的.*records\.md|基于上下文已注入的.*seeds\.md" apps/platform-web/src/storage/workspace-templates.ts
```

## 回滚点

- Phase 1（readEntity）独立，可单独回滚（改回 readEntityBrief + 调用点）。
- Phase 2（memory）独立，可单独回滚（删 records.md 模板 + contextPaths + 措辞改回）。
- 两线无依赖，可按任意顺序实现。
