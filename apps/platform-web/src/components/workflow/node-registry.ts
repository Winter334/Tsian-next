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
    label: '应用补丁（兼容）',
    description: '兼容旧 MaintenancePatchDocument 写入路径',
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
  {
    type: 'memory-query',
    label: '记忆查询',
    description: '查询 save-scoped 记忆集合',
    icon: 'Database',
    color: '#4FD1C5',
    colorClass: '[#4FD1C5]',
  },
  {
    type: 'memory-write',
    label: '记忆写入',
    description: '写入 save-scoped 记忆集合',
    icon: 'Save',
    color: '#F472B6',
    colorClass: '[#F472B6]',
  },
  {
    type: 'template-compose',
    label: '模板组合',
    description: '将输入变量组合为文本或 JSON',
    icon: 'FileText',
    color: '#A3E635',
    colorClass: '[#A3E635]',
  },
  {
    type: 'record-filter',
    label: '记录筛选',
    description: '按字段或标签筛选记录数组',
    icon: 'Filter',
    color: '#38BDF8',
    colorClass: '[#38BDF8]',
  },
  {
    type: 'record-merge',
    label: '记录合并',
    description: '合并并去重多组记录',
    icon: 'Combine',
    color: '#FB7185',
    colorClass: '[#FB7185]',
  },
  {
    type: 'record-format',
    label: '记录格式化',
    description: '将记录数组格式化为文本',
    icon: 'Rows3',
    color: '#FACC15',
    colorClass: '[#FACC15]',
  },
]

/** 按 type 快速查找 */
export const nodeTypeMap = new Map<WorkflowNodeType, NodeTypeInfo>(
  nodeTypeRegistry.map((info) => [info.type, info])
)
