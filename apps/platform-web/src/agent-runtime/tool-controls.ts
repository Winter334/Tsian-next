// apps/platform-web/src/agent-runtime/tool-controls.ts
// 平台工具开关的分组控件定义（Studio 面板与助手配置面板共用）。
//
// 两面板此前各自硬编码扁平 platformToolControls 数组，导致开关集合分叉
// （助手面板缺 workspace_semantic_search，Studio 面板缺 ask_user）。
// 本文件作为单一真相源，两面板引用同一分组结构，新增工具只需在此补一项。

import type { AgentPlatformToolName } from "@tsian/contracts"

export interface PlatformToolControl {
  id: AgentPlatformToolName
  label: string
  description: string
}

export interface PlatformToolControlGroup {
  title: string
  tools: PlatformToolControl[]
}

/**
 * 平台工具开关分组（D5：按职能分 3 组，默认全展开不折叠）。
 * use_skill / run_script 不在此列——它们是 Skill 体系的内置入口，永远启用，
 * 展示开关会误导用户以为可关。
 */
export const PLATFORM_TOOL_CONTROL_GROUPS: PlatformToolControlGroup[] = [
  {
    title: "协作与交互",
    tools: [
      {
        id: "agent_call",
        label: "Agent 协作",
        description: "允许向联系人 Agent 发起一次性咨询。",
      },
      {
        id: "ask_user",
        label: "向用户提问",
        description: "允许向用户发起提问并阻塞等待回答。",
      },
    ],
  },
  {
    title: "Workspace",
    tools: [
      {
        id: "workspace_read",
        label: "读取 Workspace",
        description: "允许读取、列出和搜索可见 Workspace 文件。",
      },
      {
        id: "workspace_write",
        label: "维护 Workspace",
        description: "允许通过平台工具或 Skill 动作写入、移动、删除或校验文件。",
      },
      {
        id: "workspace_semantic_search",
        label: "语义检索",
        description:
          "允许按含义在 save-runtime 记忆（远期剧情 turn、agent notes、memory summary）里召回，用于玩家措辞与正文无字面重叠时。需在控制面板配置 embedding API 才生效；未配置时工具返回空，agent 回退字面搜索。",
      },
    ],
  },
  {
    title: "开发与自检",
    tools: [
      {
        id: "inspect_frontend",
        label: "前端自检",
        description:
          "允许接管玩家当前 Play 窗口中的 packaged 前端，通过真实 UI 复现、观测和修复，并在结束时恢复调试前的存档运行时。",
      },
      {
        id: "test_skill_script",
        label: "脚本测试",
        description:
          "允许直接测试 Skill 的 browser_script action（不需要先 use_skill），返回结构化错误用于调试。形成写脚本→测试→看错误→改脚本闭环。",
      },
      {
        id: "query_diagnostics",
        label: "诊断查询",
        description: "按摘要、记录 ID 和分页区间查询平台诊断。",
      },
    ],
  },
]

/** 扁平化的全部工具控件（供需要遍历所有工具的场景使用）。 */
export const PLATFORM_TOOL_CONTROLS: PlatformToolControl[] = PLATFORM_TOOL_CONTROL_GROUPS.flatMap(
  (group) => group.tools,
)
