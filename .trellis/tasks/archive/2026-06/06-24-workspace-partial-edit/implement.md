# Implement: workspace 部分编辑能力

## 执行顺序（自底向上，每步可独立 build 验证）

### Phase 1: contracts 层（基础类型，下游都依赖它）

1. **`packages/contracts/src/runtime.ts`**
   - `WorkspaceOperationName`：移除 `"patch"`，加 `"edit"`
   - `WorkspaceOperationRequest`：加 `oldString?`/`newString?`/`replaceAll?` 字段 + 注释
   - `WorkspacePatchResult` → rename `WorkspaceWriteResult`
   - `npm run build` (contracts) 验证类型层编译

### Phase 2: runtime 核心实现（workspace-operations.ts）

2. **`apps/platform-web/src/agent-runtime/workspace-operations.ts`**
   - `EDIT_OPERATIONS` set：移除 `"patch"`，加 `"edit"`（L113-118）
   - `writeWorkspaceFile`：去掉 `options.checkExpectedContent` 开关，改为统一检查 `request.expectedContent`（L974-1030）
   - 新增 `editWorkspaceFile` 函数（按 design §4.2）：
     - 校验 oldString 非空、文件存在、非二进制
     - `countOccurrences`（split-join 法）
     - 0 匹配 → `WORKSPACE_EDIT_NO_MATCH`
     - >1 且非 replaceAll → `WORKSPACE_EDIT_NOT_UNIQUE`（带 matchCount）
     - 单替换用 `String.replace`，replaceAll 用 `split().join()`
     - 落盘走 `mutations.write`（复用，不加 adapter 方法）
   - operation 分发：删 `if (operation === "patch")` 分支（L1242），write 分支去 `checkExpectedContent:false` 参数，加 `if (operation === "edit") return editWorkspaceFile(...)`

3. **`apps/platform-web/src/agent-runtime/permissions.ts`**
   - `WORKSPACE_WRITE_OPERATIONS`（L27）：加 `"edit"`，移除 `"patch"`（若在数组里）

### Phase 3: 暴露面（LLM 工具 + browser_script）

4. **`apps/platform-web/src/agent-runtime/workspace-tools.ts`**
   - `RUNTIME_WORKSPACE_TOOL_NAMES`：加 `edit: "edit"`（L34-47）
   - `WORKSPACE_OPERATION_TOOL_NAMES` set：加 `"edit"`（L60-69）

5. **`apps/platform-web/src/agent-runtime/tool-schemas.ts`**
   - `workspaceWriteSchema`（L271-289）：description 去掉"full-content patch"措辞，改为"Create or overwrite a workspace file"；加 `expectedContent` 可选属性
   - 新增 `workspaceEditSchema`（按 design §5.1），加入 schema 注册数组

6. **`apps/platform-web/src/platform-host/browser-skill-script-executor.ts`**
   - worker `workspace` 对象（L150-184）：移除 `patch(input)`（L169-171），加 `edit(input)`（按 design §5.2）
   - host 侧 operation 分发已 generic（L576-577），无需改

### Phase 4: 人类前端编辑器迁移

7. **`apps/platform-web/src/platform-host/workspace-ops.ts`**
   - `writePlatformWorkspaceFile`（L660）：加 `expectedContent?: string` 参数，传入 operation
   - `patchPlatformWorkspaceFile`（L684-709）：删除或改为 `writePlatformWorkspaceFile` 的 deprecated alias（倾向直接删，调用点只有一处）
   - L460-466 `if (write || patch)` 分支：只剩 write
   - L693/702 `operation:"patch"` → `"write"`

8. **`apps/platform-web/src/views/WorkspaceEditorView.vue`**
   - L322：`patchPlatformWorkspaceFile({content, expectedContent})` → `writePlatformWorkspaceFile({content, expectedContent})`
   - import 同步

### Phase 5: 引用清理 + spec 同步

9. **全仓库 `WorkspacePatchResult` → `WorkspaceWriteResult` rename**
   - `workspace-operations.ts`、`workspace-ops.ts`、`browser-skill-script-executor.ts`、其他 import 点
   - `npm run build:web` 报错指引逐个修

10. **全仓库 `operation: "patch"` / `workspace.patch` 残留清理**
    - grep 兜底，确认除归档任务文档外无残留

11. **`.trellis/spec/platform-web/frontend/type-safety.md`**
    - L576/626/665/1094/1109：`workspace.patch` → `workspace.write`（带 expectedContent 语境）

### Phase 6: agent 文档同步

12. **studio-assistant / post agent AGENT.md**
    - 教何时用 edit vs write：大文件局部改用 edit，小文件/全量重写用 write
    - 移除任何 patch 引用

13. **Skill 文档**（若有提及 patch）
    - grep `workspace.patch` in skills/*.md，同步

## 验证命令

- `npm run build:web` —— 全链路编译，rename 残留会暴露
- `npm run test`（若有 workspace-operations 相关测试）—— edit/write 语义
- 手动验证（build 后）：
  - agent 调 `edit` 唯一匹配替换成功
  - agent 调 `edit` 不唯一报错带 matchCount
  - agent 调 `edit` 二进制文件报错
  - 人类编辑器保存（带 expectedContent）陈旧检测仍工作
  - browser_script `workspace.edit` 可用
  - `workspace.patch` 在两条路都不可用（报 unsupported）

## 风险点 / 回滚点

- **高风险**：contracts 移除 `"patch"` 是 breaking。若 build:web 后有隐藏消费者报错，回滚策略是先把 `"patch"` 作为 `"write"` 的 alias 临时保留一个版本，而非直接删——但 design 决议是直删，项目内消费者已全部排查（§6）。**建议 Phase 2 后先 build 一次**，让 TypeScript 把所有 `operation:"patch"` 字面量消费者报出来，确认无遗漏再继续。
- **中风险**：`WorkspaceEditorView.vue` 保存流程迁移——人类 UX 功能，迁移后必须手动验证陈旧检测。这是唯一的人类面行为变更。
- **低风险**：edit 新增是纯加法，不破坏现有行为。

## task.py start 前检查

- [ ] prd.md acceptance criteria 完整可测
- [ ] design.md 技术方案完整，开放点已定（edit 不带后置 validate）
- [ ] implement.md 步骤有序，验证命令明确
- [ ] 用户已 review 或批准
