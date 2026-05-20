import type { WorkflowNodeType } from '@tsian/contracts'

export interface NodeTypeInfo {
  /** 类型标识 */
  type: WorkflowNodeType
  /** 显示标签 */
  label: string
  /** 一句话描述 */
  description: string
  /** lucide 图标名称（字符串，组件侧按名称渲染） */
  icon: string
  /** 主题颜色（hex） */
  color: string
  /** Tailwind 颜色类（用于 border/bg） */
  colorClass: string
}

export const nodeTypeRegistry: NodeTypeInfo[] = [
  {
    type: 'ai-call',
    label: 'AI 调用',
    description: '调用 AI 模型生成文本',
    icon: 'Brain',
    color: '#00F0FF',
    colorClass: 'neon',
  },
  {
    type: 'result',
    label: '结果',
    description: '工作流输出结果节点',
    icon: 'Flag',
    color: '#00FF88',
    colorClass: '[#00FF88]',
  },
  {
    type: 'switch',
    label: '条件分支',
    description: '按条件路由到不同输出',
    icon: 'GitBranch',
    color: '#FF8C00',
    colorClass: 'warning',
  },
  {
    type: 'apply-patch',
    label: '应用补丁',
    description: '将 AI 输出的 patch 应用到运行时',
    icon: 'FileEdit',
    color: '#B388FF',
    colorClass: '[#B388FF]',
  },
  {
    type: 'compute',
    label: '计算',
    description: '执行自定义脚本计算',
    icon: 'Code',
    color: '#FFD600',
    colorClass: '[#FFD600]',
  },
]

/** 按 type 快速查找 */
export const nodeTypeMap = new Map<WorkflowNodeType, NodeTypeInfo>(
  nodeTypeRegistry.map((info) => [info.type, info])
)
