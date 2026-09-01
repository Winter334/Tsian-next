# 脚本 helper 从模板字符串提取为独立文件

## Goal

把 Skill 脚本当前的"共享 helper 模板字符串拼接"机制（`OPENING_SCRIPT_COMMON` / `OPENING_SCRIPT_VALIDATION` 在 `workspace-templates.ts` 里定义为字符串常量，9 个脚本通过 `${OPENING_SCRIPT_COMMON}${text([...])}` 拼接）替换为"helper 作为独立 `.js` 文件放在 Skill 的 `scripts/` 目录，平台运行时按 Skill action 声明读取并拼接到脚本前"。

解决的技术债：脚本不是自包含的——单独看 `inspect-source-opening.js` 看不到 `loadSource`/`readText` 从哪来；IDE 无补全/无跳转；helper 迭代要重新生成所有脚本模板；脚本作者写代码时看不到 helper 定义。

## Background

### 现状

`apps/platform-web/src/storage/workspace-templates.ts` 里：

- `OPENING_SCRIPT_COMMON`（~24 行 JS）：`isRecord` / `fail` / `parseJson` / `readJson` / `readText` / `cleanText` / `clipText` / `normalizePositiveInt` / `loadSource`
- `OPENING_SCRIPT_VALIDATION`（~105 行 JS）：`normalizeString` / `normalizeSegment` / `normalizeEntityId` / `normalizeEntity` / `ensureSourceRefsKnown` / `normalizeRef` / `normalizeScene` / `scopeFromSubject` / `normalizeRelationships` / `normalizeCandidate` / `normalizeWindow` / `loadExistingEntityIds`

9 个脚本通过字符串拼接复用这两个 helper：

| 脚本 | COMMON | VALIDATION |
|---|---|---|
| inspect-source-opening | ✓ | |
| read-opening-slice | ✓ | |
| commit-entities | ✓ | ✓ |
| commit-scenes-and-relationships | ✓ | ✓ |
| commit-runtime-and-frontier | ✓ | ✓ |
| commit-understanding-summary | ✓ | ✓ |
| commit-opening-narrative | ✓ | |
| commit-setup-summary | ✓ | |
| commit-mode | ✓ | |

脚本本身已经是独立 `.js` 文件（通过 `executor.path` 引用），不是嵌在 SKILL.md fence 里。问题只在 helper 的拼接方式。

### 运行时不变

脚本仍跑在 Web Worker + `new AsyncFunction` eval。本任务不引入 ES module / `import`——运行时仍然是"读源码 + 拼 helper + eval"。只是把 helper 来源从"编译期模板字符串"换成"运行时读 workspace 文件"。

## Requirements

### R1: helper 作为独立 `.js` 文件

- helper 文件放在 Skill 的 `scripts/` 目录内，和脚本同级。
- 文件名约定 `_` 前缀表"不直接执行，只被引用"（如 `_common.js`、`_validation.js`）。
- helper 文件不被 `run_script` 直接调用（它们没有 `executor` 声明，不在 Skill action 列表里）。

### R2: Skill action 声明 `helpers` 字段

Skill action 的 `executor` 对象新增可选字段 `helpers`：

```json
{
  "executor": {
    "type": "browser_script",
    "path": "scripts/commit-entities.js",
    "timeoutMs": 10000,
    "helpers": ["_common.js", "_validation.js"]
  }
}
```

`helpers` 是字符串数组，省略时为空数组。

### R3: helper 路径解析规则

- **相对路径**：以 `./` 或 `../` 开头，或不含 `/` → 相对当前 Skill 的 `scripts/` 目录解析。例：`_common.js`、`./_common.js`、`sub/foo.js`。
- **绝对路径**：含 `/` 但不以 `./` 或 `../` 开头 → 从 workspace 根开始解析。例：`agents/world-architect/skills/开局建模/scripts/_common.js`。
- 路径逃逸（`../` 跳出 workspace 根）报错。
- 默认推荐相对路径；文档说明绝对路径会破坏 Skill 自包含性，慎用。

### R4: 平台运行时拼接

平台执行 `run_script` 时：

1. 读目标脚本源码（和现状一样）。
2. 读 `executor.helpers` 声明的 helper 文件源码（通过 `workspace.read`）。
3. 按 `helpers` 数组顺序拼接到脚本源码前。
4. `new AsyncFunction(...)` eval 拼接后的源码（和现状机制一致）。

helper 读取失败（文件不存在、路径逃逸）报清晰错误，不静默跳过。

### R5: Skill 级共享，不跨 Skill

- helper 只在 Skill 的 `scripts/` 目录内可见，只服务该 Skill 的脚本。
- 不支持 Agent 级或卡级共享层。
- 不同 Skill 需要相同 helper 时，各自维护一份。这是**有意的重复**——换来 Skill 自包含、可独立分发、玩家可理解。

理由（用户 2026-07-05 判断）：跨 Skill/Agent/卡级共享对普通玩家理解困难，且不适合分发。Skill 是自包含的能力单元，它的 SKILL.md + scripts + helpers 都该在一个目录里。

### R6: 现有 9 个脚本迁移

- `OPENING_SCRIPT_COMMON` → `agents/world-architect/skills/开局建模/scripts/_common.js`（独立 `.js` 文件，内容是原 helper 源码）
- `OPENING_SCRIPT_VALIDATION` → `agents/world-architect/skills/开局建模/scripts/_validation.js`
- `commit-setup-summary.js` 在 `游玩设定` Skill 下，`commit-mode.js` 在 `玩法启用` Skill 下——它们各自 Skill 的 `scripts/` 要有自己的 `_common.js`（从同一模板复制，有意重复）。
- 9 个脚本源码去掉 `${OPENING_SCRIPT_COMMON}` / `${OPENING_SCRIPT_VALIDATION}` 拼接，改为纯脚本逻辑。
- 对应 Skill action 声明加 `helpers` 字段。
- `workspace-templates.ts` 里的 `OPENING_SCRIPT_COMMON` / `OPENING_SCRIPT_VALIDATION` 常量删除（或改为仅供迁移期参考）。

### R7: helper 文件命名约定文档

- Skill `scripts/` 目录下 `_` 前缀文件是 helper，不直接执行。
- `workspace.list` 或 Skill action 列表渲染时，可据此区分 helper 和可执行脚本（可选，第一版不强制）。

## Acceptance Criteria

- [ ] Skill action 的 `executor` 支持 `helpers` 字段（字符串数组，可选）。
- [ ] 平台执行 `run_script` 时按 `helpers` 声明读取 helper 文件源码并拼接到脚本前。
- [ ] helper 路径解析支持相对路径（相对 Skill scripts/ 目录）和绝对路径（workspace 根）。
- [ ] helper 读取失败（文件不存在、路径逃逸）报清晰错误。
- [ ] `OPENING_SCRIPT_COMMON` / `OPENING_SCRIPT_VALIDATION` 提取为独立 `.js` 文件，放在对应 Skill 的 `scripts/` 目录。
- [ ] 9 个脚本源码不再通过模板字符串拼接 helper，改为 `helpers` 声明。
- [ ] `commit-setup-summary.js` 和 `commit-mode.js` 所在 Skill 各自有 `_common.js`（有意重复）。
- [ ] `workspace-templates.ts` 里 `OPENING_SCRIPT_COMMON` / `OPENING_SCRIPT_VALIDATION` 常量不再被脚本拼接使用。
- [ ] 现有 9 个脚本经 `test_skill_script` 或实际 Skill 调用验证功能不变。
- [ ] `npm run build:web` 通过。
- [ ] helper 路径解析规则和命名约定有文档说明。

## Out of Scope

- **ES module / `import` 支持**：运行时仍是 `AsyncFunction` eval + 拼接，不引入 ES module。ES module 升级待"触发信号"出现再考虑（见 `07-05-agent-tool-mechanism` OQ 或后续讨论）。
- **跨 Skill / Agent 级 / 卡级 helper 共享**：不支持。helper 跟 Skill 走，有意重复优于跨目录追踪。
- **工具机制的 helper 复用**：`07-05-agent-tool-mechanism` 的 `tool.json` 是否支持 `helpers` 留给该任务决定，但本任务铺好基础（平台已有 helper 读取 + 拼接逻辑可复用）。
- **TypeScript 支持**：不做。和 Tsian"workspace 即源、无构建步骤"哲学冲突。
- **helper 热重载**：helper 改动后下次执行自动读到新版本（因为每次执行都读文件），不额外做热重载机制。

## Notes

- 本任务源于 2026-07-05 关于"脚本运行时是否够用"的讨论。结论：运行时够用，但共享 helper 字符串拼接是技术债——脚本不自包含、IDE 无补全、helper 迭代成本高。
- 用户判断：helper 跟 Skill 走（Skill 级共享），不跨 Skill/Agent/卡级——理由是普通玩家理解困难 + 不适合分发。Skill 是自包含的能力单元。
- 用户判断：相对路径和绝对路径都支持——相对路径是推荐用法（Skill 自包含），绝对路径用于 Skill 内文件在 scripts/ 之外等少数场景。文档说明绝对路径破坏自包含性，慎用。
- 与 `07-05-agent-tool-mechanism` 的关系：工具机制也会面对"工具实现文件形态 + 共享逻辑"问题。本任务的 helper 读取 + 拼接逻辑可被工具机制复用。两个任务可独立推进，但建议本任务先行（它更简单、边界更清晰）。
