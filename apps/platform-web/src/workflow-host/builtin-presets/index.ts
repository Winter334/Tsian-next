/**
 * 平台默认 prompt preset 种子数据。
 *
 * 默认工作流通过 3 个固定资源 id 引用：
 *   - builtin.retrieval   → retrieval.preset.json
 *   - builtin.chat        → chat.preset.json
 *   - builtin.maintenance → maintenance.preset.json
 *
 * 注意：这里仅提供写入资源库的初始种子；运行时不再直接消费隐藏 Map，
 * 而是从 IndexedDB 资源库读取 prompt preset。
 */

import type { PresetInfo } from "@tsian/prompt-engine"
import retrievalPreset from "./retrieval.preset.json"
import chatPreset from "./chat.preset.json"
import maintenancePreset from "./maintenance.preset.json"

export interface BuiltinPromptPresetSeed {
  id: string
  name: string
  description: string
  preset: PresetInfo
}

export const builtinPromptPresetSeeds: ReadonlyArray<BuiltinPromptPresetSeed> = [
  {
    id: "builtin.retrieval",
    name: "默认检索提示词预设",
    description: "平台默认检索 AI prompt preset；作为资源库内置种子写入，可在资源库中查看与替换。",
    preset: retrievalPreset as unknown as PresetInfo,
  },
  {
    id: "builtin.chat",
    name: "默认正文提示词预设",
    description: "平台默认正文 AI prompt preset；作为资源库内置种子写入，可在资源库中查看与替换。",
    preset: chatPreset as unknown as PresetInfo,
  },
  {
    id: "builtin.maintenance",
    name: "默认维护提示词预设",
    description: "平台默认维护 AI prompt preset；作为资源库内置种子写入，可在资源库中查看与替换。",
    preset: maintenancePreset as unknown as PresetInfo,
  },
]
