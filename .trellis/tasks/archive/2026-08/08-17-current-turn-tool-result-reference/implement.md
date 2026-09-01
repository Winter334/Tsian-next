# Implementation Plan

## 1. Session Registry And Producer

- 扩展 `RuntimeWorkspaceToolSessionState` 与创建函数，加入字符串 registry 和 Provider 无关的递增 ID。
- 在共享 tool execution 路径为成功 `agent_call.response` 构造候选 `responseRef`。
- 让带引用的候选 observation 通过最终 acceptance gate 后再注册，保持失败/超限无残留。

## 2. `run_script` Consumer

- 在 `run_script` Tool schema 增加可选 `inputRefs`，说明仅映射 action input 顶层字段。
- 在 `executeRunScript` 增加纯解析 helper：校验 map、检查字段冲突、查找 registry、生成新的 action input。
- 固定调用顺序为引用解析、action schema、policy、browser script；返回约定的结构化错误。

## 3. Persistence Boundaries

- 从 Tool memory exact-field 提取中排除 `responseRef`。
- 确认 UI presentation、timeline、会话历史和 workspace 没有引用 registry/value 的新增写入。
- 确认 text/native 都只消费共享 accepted observation 和共享 resolver。

## 4. Opening Skill

- 更新卡内 `开局建模/SKILL.md` 的阶段 5–7：保留 response 对齐，提交时使用 `inputRefs.openingReply`，不内联复制正文。
- 通过现有 workspace-template raw import 保持模板镜像一致，不新建第二份 Skill 文本。

## 5. Verification

- 扩展既有 `assistant-runtime.smoke.test.ts` 主干场景，覆盖逐字正文引用与执行前失败/事务不变；不新增测试文件。
- 运行 `npm run test:smoke:web`、`npm run build:web`、`git diff --check`。
- 审计新增断言的长期保留价值，删除一次性实现探针；真实 Provider 行为留给实际调用复核。

## Rollback

- 将 session registry、observation `responseRef`、`run_script.inputRefs`、resolver、memory 排除和 Skill 指引视为一个回滚单元。
- 不以持久化 artifact、递归路径或 JSON repair 作为失败后的临时替代。
