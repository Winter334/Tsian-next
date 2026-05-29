// Mirror types from @tsian/prompt-engine — keep in sync manually

// =========================
// 正则脚本
// =========================

export type RegexTarget = 'userInput' | 'aiOutput' | 'slashCommands' | 'worldBook' | 'reasoning'
export type RegexView = 'user' | 'model'
export type RegexMacroMode = 'none' | 'raw' | 'escaped'

export interface RegexScriptData {
  /** 唯一标识符 */
  id: string
  /** 脚本名称 */
  name: string
  /** 是否启用 */
  enabled: boolean
  /** 查找正则 */
  findRegex: string
  /** 替换文本 */
  replaceRegex: string
  /** 修剪文本列表（Trim Out） */
  trimRegex: string[]
  /** 作用位置列表（Affects） */
  targets: RegexTarget[]
  /** 视图过滤（user: 仅显示；model: 仅发送给模型） */
  view: RegexView[]
  /** 是否在编辑时运行（引擎内不使用，但保留字段） */
  runOnEdit: boolean
  /**
   * 宏替换模式（仅影响 Find Regex）
   * - none: 不执行宏，按宏字面量查找（如 {{user}}）
   * - raw: 先执行宏，不转义
   * - escaped: 先执行宏，再做正则转义
   */
  macroMode: RegexMacroMode
  /** 最小深度（聊天历史，0=最后一条）；null=无限制 */
  minDepth: number | null
  /** 最大深度（聊天历史）；null=无限制 */
  maxDepth: number | null
}

// =========================
// 世界书
// =========================

export type WorldBookEntryPosition =
  | 'beforeChar'
  | 'afterChar'
  | 'beforeEm'
  | 'afterEm'
  | 'beforeAn'
  | 'afterAn'
  | 'fixed'
  | 'outlet'
  | string

export type WorldBookEntryRole = 'system' | 'user' | 'model'
export type WorldBookEntrySelectiveLogic = 'andAny' | 'andAll' | 'notAll' | 'notAny'
export type WorldBookEntryActivationMode = 'always' | 'keyword' | 'vector'

export interface WorldBookEntry {
  index: number
  name: string
  content: string
  enabled: boolean
  activationMode: WorldBookEntryActivationMode
  key: string[]
  secondaryKey: string[]
  selectiveLogic: WorldBookEntrySelectiveLogic
  order: number
  depth: number
  position: WorldBookEntryPosition
  /** 仅 fixed 有意义；不使用时为 null */
  role: WorldBookEntryRole | null
  /** null: 使用默认；true/false: 显式覆盖 */
  caseSensitive: boolean | null
  excludeRecursion: boolean
  preventRecursion: boolean
  probability: number
  other: Record<string, any>
}

export interface WorldBook {
  name: string
  entries: WorldBookEntry[]
}

// =========================
// 预设
// =========================

/**
 * Utility Prompts：从 `other`（旧名 apiSetting）中迁移出来的一组常用字段。
 */
export interface UtilityPrompts {
  impersonationPrompt?: string
  worldInfoFormat?: string
  scenarioFormat?: string
  personalityFormat?: string
  groupNudgePrompt?: string
  newChatPrompt?: string
  newGroupChatPrompt?: string
  newExampleChatPrompt?: string
  continueNudgePrompt?: string
  sendIfEmpty?: string
  seed?: number
}

export interface PromptPresetEntry {
  identifier: string
  name: string
  /** 是否启用（若来自 ST，enabled 通常已融合 prompt_order 的状态） */
  enabled: boolean
  /** 在预设顺序列表中的索引（可选） */
  index?: number
  /** 角色：system/user/assistant/model/... */
  role: string
  content: string
  depth: number
  order: number
  trigger: any[]
  position: 'relative' | 'fixed'
  /** 其它原始字段（marker/forbid_overrides/...） */
  [key: string]: any
}

export interface PromptPreset {
  name: string
  prompts: PromptPresetEntry[]

  /** 从 other 中迁移出的 Utility Prompts（camelCase） */
  utilityPrompts: UtilityPrompts

  /** 预设绑定正则脚本 */
  regexScripts: RegexScriptData[]

  /**
   * 其它采样参数（旧名 apiSetting）
   */
  other: any

  /** @deprecated 已重命名为 other */
  apiSetting?: any
}
