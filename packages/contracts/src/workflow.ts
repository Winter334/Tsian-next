/**
 * 工作流引擎跨包类型契约
 *
 * 设计来源：openspec/changes/prompt-preset-and-workflow-engine/design.md §4 + §7
 *
 * 形态选择：契约层只描述"形状骨架"，节点 config 用 Record<string, unknown>。
 * 节点实现层（apps/platform-web/src/workflow-host/*）负责把 config 解析成各 NodeConfig 并校验字段。
 * 加载期校验（design.md §13.4）由 workflow-engine 在执行前统一执行，不依赖 TS 编译期收紧。
 */

import type { PromptPreset, WorldBook } from "./preset"

// ============================================================================
// 节点输出提取规则（design.md §4）
// ============================================================================

export type NodeOutputExtractRule =
  | { type: "tag"; tag: string; parse?: "json" | "number" }
  | { type: "regex"; pattern: string; flags?: string; group?: number; parse?: "json" | "number" }
  | { type: "raw"; parse?: "json" | "number" }

export interface NodeOutputDeclaration {
  /** 端口名（边里 from.outputName 引用） */
  name: string
  extract: NodeOutputExtractRule
}

// ============================================================================
// 节点类型与节点骨架（design.md §7）
// ============================================================================

export type WorkflowNodeType = "ai-call" | "result" | "switch" | "apply-patch" | "compute"

export interface WorkflowNodeBase<T extends WorkflowNodeType = WorkflowNodeType> {
  id: string
  type: T
  /** 用户自定义节点名称；缺省时 UI 层回退到 nodeTypeRegistry 的 label */
  label?: string
  /** 节点配置；具体形状由节点实现层按 type 解析（见各 *NodeConfig 类型） */
  config: Record<string, unknown>
  retry?: { maxRetries: number }
  /** ai-call / compute 节点用；其它节点忽略 */
  outputs?: NodeOutputDeclaration[]
  /** 节点在可视化编辑器中的画布坐标 */
  position?: { x: number; y: number }
}

export type WorkflowNode = WorkflowNodeBase

// ============================================================================
// 各节点 config 形状（实现层 cast/解析时使用，不进 WorkflowNode 联合）
// ============================================================================

export interface AiCallNodeConfig {
  /** 引用平台资源库 prompt preset id；builtin.* 仅表示内置种子资源 id */
  presetId: string
  /** 引用平台资源库 world book id；builtin.* 仅表示内置种子资源 id */
  worldBookKeys?: string[]
  /** 是否把 user.input 追加到 messages */
  appendUserInput?: boolean
  /**
   * H8 β-1 旁路：跳过 AI 调用，直接从 context.macros[rawFromMacro] 读取作为 outputs.raw。
   * 用于 retrieval 节点过渡期 — platform-host 仍调旧 assembleRetrievalContext 生成 prompt，
   * 灌入此 macro 让节点形态保持完整。H10 下沉 retrieval 后应删除本字段。
   */
  bypass?: {
    rawFromMacro: string
  }
}

export interface ResultNodeConfig {
  /** 写入 outputs.results[name] */
  name: string
}

export interface SwitchNodeConfig {
  /** when = 简单等值字符串匹配（原型期，design.md §13.2） */
  cases: Array<{ when: string; outputName: string }>
  defaultOutputName?: string
}

export interface ApplyPatchNodeConfig {
  /** 从 inputs[patchVarName] 取 patch JSON */
  patchVarName: string
  /** 默认 "after-turn"；桥 API 路径为 undefined（design.md §13.9） */
  pushCheckpointReason?: string
}

export interface ComputeNodeConfig {
  /** function body string */
  script: string
  /** 默认 5000 ms */
  timeout?: number
}

// ============================================================================
// 边（design.md §7）
// ============================================================================

export interface WorkflowEdge {
  from: { nodeId: string; outputName?: string }
  to: { nodeId: string; varName: string }
  /** 原型期：简单字符串等值匹配上游端口值（design.md §13.2） */
  condition?: string
}

// ============================================================================
// 顶层定义（design.md §7）
// ============================================================================

export interface WorkflowDefinition {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

// ============================================================================
// 平台资源库契约
// ============================================================================

export type PlatformResourceKind = "prompt-preset" | "world-book" | "workflow-preset"

export interface PlatformResourceBase<K extends PlatformResourceKind = PlatformResourceKind> {
  id: string
  kind: K
  name: string
  description?: string
  tags: string[]
  createdAt: number
  updatedAt: number
}

export interface PromptPresetResource extends PlatformResourceBase<"prompt-preset"> {
  preset: PromptPreset
}

export interface WorldBookResource extends PlatformResourceBase<"world-book"> {
  worldBook: WorldBook
}

export interface WorkflowPresetResource extends PlatformResourceBase<"workflow-preset"> {
  workflow: WorkflowDefinition
}

export type PlatformResource =
  | PromptPresetResource
  | WorldBookResource
  | WorkflowPresetResource
