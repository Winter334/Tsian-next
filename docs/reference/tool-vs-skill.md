# Tool 与 Skill 边界（07-05 任务落地）

从 07-05 任务开始，Tsian 平台在原有 Skill 层之外正式引入 **Tool** 层。两层可以并存，覆盖不同的使用场景。本页是简明说明，配置字段以 `tool.json` / `agent.json` / `SKILL.md` 里的实际实现为准。

## 一句话区分

- **Tool** = *能力*。直接暴露给 LLM 的原生函数调用。一次输入 → 一次输出。
- **Skill** = *知识 + 一组 action*。LLM 先 `use_skill` 激活拿到全文说明，再用 `run_script` 触发脚本。

两者的执行器都是同一个 `browser_script` runner；差异在**发现路径**、**LLM 可见形式**、**是否携带激活语义**。

## 什么时候用 Tool

- 一次调用就能得到结果，不需要先「读文档」的能力。
- 你希望 LLM 把它当成常规的原生函数来推理。
- 例：`roll_dice`、单次 HTTP 查询、单次格式化。

## 什么时候用 Skill

- 有一段说明 / SOP / 用法指南，LLM 需要读过之后再决定如何组合多个 action。
- 有多个相关 action 共享同一份领域知识。
- 例：一整套「行动裁定」流程、entity 归一化流水线。

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

- Tool 脚本运行在 Worker 里，与主线程 DOM/localStorage 隔离。
- 与 Skill 相同：`workspace.*` 通过 SDK RPC 走主线程，受 Agent `workspaceAccess` 权限约束。
- 卡内容里的 Tool 目录内容可以进创意工坊分发——审阅同 Skill：审 `run.js`、审 `helpers`、审 `tool.json.parameters`。`.tsian/local/**` 默认不随卡包分发，但可由用户显式上传为独立 Tool 资源包。

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
- ❌ 用 Tool 做「有状态的多步流程」。多步流程应拆成多个 Tool 或做成 Skill action。
