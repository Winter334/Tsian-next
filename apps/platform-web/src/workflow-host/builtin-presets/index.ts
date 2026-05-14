/**
 * 平台内置 PresetInfo 集（H5 / design.md §8）
 *
 * 默认工作流（H6）通过 3 个固定 key 引用：
 *   - builtin.retrieval   → retrieval.preset.json
 *   - builtin.chat        → chat.preset.json
 *   - builtin.maintenance → maintenance.preset.json
 *
 * 这些 preset 由 ai-call executor 在装配时按 PresetInfo 形态消费
 * （@tsian/prompt-engine 的 assemblePromptFromPreset）。
 *
 * JSON 直接 import 依赖 tsconfig.app.json 中已开启的 `resolveJsonModule: true`。
 * 类型层用 `as unknown as PresetInfo` 二次 cast：JSON 不带强类型签名，executor
 * 内部仍会做最小字段校验（design.md §1.2 / H4 ai-call.ts 保留 cast 校验）。
 */

import type { PresetInfo } from "@tsian/prompt-engine"
import retrievalPreset from "./retrieval.preset.json"
import chatPreset from "./chat.preset.json"
import maintenancePreset from "./maintenance.preset.json"

export const builtinPresets: ReadonlyMap<string, PresetInfo> = new Map<
  string,
  PresetInfo
>([
  ["builtin.retrieval", retrievalPreset as unknown as PresetInfo],
  ["builtin.chat", chatPreset as unknown as PresetInfo],
  ["builtin.maintenance", maintenancePreset as unknown as PresetInfo],
])
