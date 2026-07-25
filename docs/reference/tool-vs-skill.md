# Tool、Skill 与 Frontend Action 边界

从 07-05 任务开始，Tsian 平台在原有 Skill 层之外正式引入 **Tool** 层；Frontend Action 则是卡自己的游玩前端调用的第三种能力。三者都可以使用 `browser_script` 执行器，但发布源、调用者和可见性完全不同。本页是简明说明，配置字段以 `tool.json` / `agent.json` / `SKILL.md` / `frontend-actions/<id>/action.json` 的实际实现为准。

## 一句话区分

- **Tool** = *直接给 LLM 的能力*。作为原生函数调用暴露，一次输入 → 一次输出。
- **Skill** = *给 LLM 的知识 + 一组 action*。LLM 先 `use_skill` 激活说明，再用 `run_script` 触发脚本。
- **Frontend Action** = *卡前端调用的卡内业务动作*。前端只按约定 id 调 `tsian.card.runAction()`；它不属于 LLM 能力面。

三者可以复用 Worker runner，但不能因此混用 Registry 或调用入口：Tool/Skill 面向 Agent，Frontend Action 只面向当前卡的 mounted frontend。

## 什么时候用 Tool

- 一次调用就能得到结果，不需要先「读文档」的能力。
- 你希望 LLM 把它当成常规的原生函数来推理。
- 例：`roll_dice`、单次 HTTP 查询、单次格式化。

## 什么时候用 Skill

- 有一段说明 / SOP / 用法指南，LLM 需要读过之后再决定如何组合多个 action。
- 有多个相关 action 共享同一份领域知识。
- 例：一整套「行动裁定」流程、entity 归一化流水线。

## 什么时候用 Frontend Action

- 只有卡自己的前端需要触发，且动作要把多次 `save-runtime` 读写作为一个受校验、可回滚的事务提交。
- 需要 input/output JSON Schema、AbortSignal、超时、并发冲突检测或提交后的路径级 mutation event。
- 前端已知道 action id；平台不会提供动态枚举 API，也不会从 Action 自动生成 UI。
- 例：某个卡的按钮对其私有 save 数据做一组原子更新。领域结构仍由卡自己定义，平台不硬编码。

不要把 Frontend Action 当成“可由前端调用的 Tool/Skill”。它不会进入 Agent、Skill、Tool Registry，不出现在模型上下文、查询结果或 Studio 的 Agent 能力面；`frontend-actions/**` 对 runtime game Agent 的 read/list/search/glob、`contextPaths` 和宏展开均不可见。桌面助手与资源管理器仍可把这些文件作为卡内容进行创作和管理。

## Frontend Action 发布与调用

固定目录本身就是发布声明，不在 `game-card.json` 增加 allowlist：

```text
frontend-actions/<kebab-id>/action.json
frontend-actions/<kebab-id>/run.js
frontend-actions/<kebab-id>/helpers/**
```

只有精确的 `frontend-actions/<id>/action.json` 会发布 Action；id 来自目录，不在 manifest 重复。调用必须使用：

```ts
const result = await tsian.card.runAction("apply-choice", input, { signal })
```

Frontend Action 不能通过 generic `tsian.runAction` 调用，也不能交给 `platform.runAction`。后两者是同一 host-owned platform action dispatcher 的 SDK/协议入口；远程 play frontend 只能调用 host 的固定 closed allowlist，未知/未来新增 action 默认拒绝，不能借 `workspace.*` action 或伪造 actor/scope/save/session 身份取得桌面助手权限。

完整 manifest、严格 JSON/Schema、事务和错误契约见 [Frontend Actions](../sdk/frontend-actions.md)。

## 目录布局

```
tools/<id>/tool.json            # 共享 Tool，所有 Agent 可见
tools/<id>/run.js
agents/<agent>/tools/<id>/…     # Agent 私有 Tool，仅该 Agent 可见；同名可覆盖共享
.tsian/local/<agent>/tools/<id>/…  # 机器私有 Tool，不入 checkpoint、不随卡包分发；可显式导出为 Tool 资源包
```

Skill 目录布局同构：`skills/<id>/SKILL.md`、`agents/<agent>/skills/<id>/SKILL.md`、`.tsian/local/<agent>/skills/<id>/SKILL.md`。

## `tool.json` 字段契约

必填：

- `name`：小写下划线，正则 `^[a-z][a-z0-9_]{0,63}$`，同时也是 LLM 拿到的函数名。
- `description`：中文描述，直接进函数 schema `description`。
- `parameters`：JSON Schema 形状的 object。
- `executor.type`：目前仅支持 `"browser_script"`。
- `executor.path`：脚本文件（相对 Tool 目录，不能以 `/` 开头，不能含 `..`）。

可选：

- `title`：Studio 显示的中文短标题；缺省用 `name`。
- `executor.timeoutMs`：单次执行超时，默认 10000。
- `executor.helpers`：辅助 JS 文件路径（相对 Tool 目录）。
- `outputSchema`：目前仅存不校验；后续任务可能启用。

保留名（会被拒绝注册）：

- 7 个 workspace 内置操作（`read`, `list`, `search`, `glob`, `diff`, `write`, `edit` 等）
- `use_skill`
- `run_script`

自定义 Tool 与保留名冲突会在 Studio 注册诊断里报 `TOOL_NAME_RESERVED`。

## 冲突与作用域

- 同一 scope 内重名 → `TOOL_NAME_DUPLICATE_SAME_SCOPE`，两个都跳过（保守），修好之前该名字对该 Agent 不可用。
- Agent-local Tool 与共享同名 → 同时保留，Agent-local 覆盖共享；发一条 `info` 级 `TOOL_AGENT_LOCAL_OVERRIDES_SHARED` 诊断。
- Agent-local Tool 只对声明它的 Agent 可见，永远不会「渗透」到其它 Agent。

Agent 侧的可见性由 `agent.json.tools` 控制：

```json
{
  "tools": {
    "enabled": [],   // 非空时视作白名单
    "disabled": []   // 黑名单
  }
}
```

- 两个字段都为空 → 「声明即暴露」：能看到的所有 Tool 都开放。
- `enabled` 非空 → 白名单模式：只暴露列出的。
- `disabled` 无论 enabled 是否为空都生效，屏蔽列出的。

## `tsian.lib.*` SDK

Tool 脚本（以及 Skill 脚本）可用的确定性小工具。收纳原则：

- 纯函数、无状态、无副作用、无网络 IO。
- 「平台不承担精确算术」——`tsian.lib.math` / 表达式求值器**不会**加入。衍生数值（伤害、总分、消耗）由前端在状态变更点算好写回 workspace，LLM 只读终值。

当前实现：

- `tsian.lib.random.nextInt(minInclusive, maxInclusive)`：闭区间整数。
- `tsian.lib.random.dice({ sides, count?, modifier?, advantage?, disadvantage? })`：故事骰。使用 `Math.random`，不做加密安全。

## Tool 脚本环境（与 Skill 脚本的差异）

Tool 脚本运行在同一个 Web Worker sandbox 里，但：

- `tsian.config` **恒为** `{}`。Tool 不读 skill.config 定义，也不合并玩家覆盖。有环境化配置的能力应写成 Skill。
- 路径根基于 Tool 目录：`importScripts('./x.js')`、`helpers`、`executor.path` 都相对 Tool 目录解析，越界立即报错。
- Tool 不需要先 `use_skill`，也不能被 `run_script` 触发——它已经是原生工具了。

## 安全姿势

- Tool/Skill 脚本运行在 Worker 里，与主线程 DOM/localStorage 隔离。
- Tool/Skill 的 `workspace.*` 通过 SDK RPC 走主线程，受当前 Agent `workspaceAccess` 权限约束。
- Frontend Action 固定使用 frontend actor level 1 和专用 operation allowlist；持久写入只允许普通 `save-runtime` 路径，不能写卡内容、卡前端或 `.tsian/**`。
- Frontend Action 的多步 mutation 先 staging，严格输出校验和 read-set CAS 成功后才原子提交；失败、取消、超时或冲突零写入且不自动重试，也不创建 checkpoint。现有 `tsian.workspace.write` 仍是独立的立即写入 API，不属于这个事务。
- Worker 不是 capability-secure 或 deterministic sandbox：当前 runner 保留原生 `fetch`、时间、计时器、随机数和动态代码执行能力，同时不提供 DOM、storage、XHR/WebSocket、nested Worker、IndexedDB/Cache 等参数能力。不要把“不接触主线程 DOM”描述成网络隔离或确定性保证。
- 卡内容里的 Tool/Skill/Frontend Action 都随卡内容分发并需要审阅脚本、helpers 与声明文件；`.tsian/local/**` 默认不随卡包分发。

## 创意工坊分发

- 完整游戏卡包会携带卡内容里的共享 Tool（`tools/<id>/...`）与 Agent-local Tool（`agents/<agent>/tools/<id>/...`）。
- 创意工坊也支持独立 Tool 资源包：包内容是某个 Tool 目录内的文本文件，根目录必须包含 `tool.json`，可安装到卡共享 `tools/`、指定 Agent 的 `agents/<agent>/tools/`，或桌面助手 `.tsian/local/assistant/tools/`。
- `.tsian/local/**` 默认仍是本机私有：不进 checkpoint，也不随完整卡包自动分发；只有用户显式上传为 Tool 资源包，或上传完整桌面助手 Agent 包时才会分发。
- Tool 资源包只携带 Tool 目录内容，不携带 `agent.json.tools.enabled/disabled` 启停状态；安装后是否对某个 Agent 暴露仍由 Studio / 助手配置面板管理。

## Studio 面板

- 「自定义 Tools」段落按选中的 Agent 展示可见 Tool 列表；勾选写回 `agent.json.tools.enabled/disabled`。
- 「Tool 注册诊断」段落仅在存在诊断时可见，展示 severity / code / message / path / hint；诊断永不导致卡包加载失败。
- 状态栏（footer）显示 `N 个 Agent · N 个 Skill · N 个 Tool`；有诊断时追加 `⚠ N 条注册诊断`。

## 反模式

- ❌ 把「表达式求值 / 变量插值 / DSL」做成 Tool。改由前端算好写入 workspace。
- ❌ 用 Tool 承载 SOP / 使用说明。这些属于 Skill 的 SKILL.md。
- ❌ 用 Tool 做「有状态的多步流程」。面向 Agent 的多步流程应拆成多个 Tool 或做成 Skill action；只面向卡前端且需要原子 save mutation 时才考虑 Frontend Action。
- ❌ 把 Tool/Skill 注册后再从前端调用，或把 Frontend Action 放入 Agent/Skill/Tool Registry。
- ❌ 调用 `tsian.runAction("...")` / `platform.runAction("...")` 来执行卡内 Frontend Action。正确入口只有 `tsian.card.runAction(actionId, input, options)`。
- ❌ 把 Worker 说成确定性、安全能力沙箱。具体 Action 的确定性要由作者代码与测试保证。
