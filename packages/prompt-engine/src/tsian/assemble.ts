/**
 * Tsian 高层 API：assemblePromptFromPreset
 *
 * 包装 fast-tavern 的 buildPrompt + channel 序列化，给 Tsian 平台/工作流引擎使用。
 *
 * 职责边界：
 * - 字段映射（AssembleInput → BuildPromptParams）
 * - 默认值填充（channel='openai', view='model'）
 * - rendered 字符串生成（text channel 直返字符串；其它 channel JSON.stringify）
 *
 * 不做：
 * - 不改 fast-tavern 任何 core 文件
 * - 不重写 convert/macro/regex/channel pipeline（buildPrompt 内部已编排）
 * - 不引入新依赖
 *
 * 详见 openspec/changes/prompt-preset-and-workflow-engine/design.md §1.2
 */

import type {
  ChatMessage,
  PresetInfo,
  RegexScriptData,
  TaggedContent,
  WorldBook,
} from '../core/types';

import { buildPrompt } from '../core/modules/build/buildPrompt';

/**
 * Tsian 装配入参。
 *
 * 与 fast-tavern BuildPromptParams 的关系：本接口是面向 Tsian 平台/模组的最小子集，
 * 字段命名与默认值由 Tsian 决定，不直接暴露 fast-tavern 的 `globals` / `outputFormat` / `systemRolePolicy`
 * 等概念。映射规则见 design.md §1.2。
 */
export interface AssembleInput {
  /** 预设（PresetInfo）：来自模组 manifest.presets[key] 或平台 builtin-presets/*.json */
  preset: PresetInfo;
  /** 可选：模组传入 lorebook（与 preset.worldBook 解耦的全局世界书） */
  worldBooks?: WorldBook[];
  /** 可选：额外正则脚本，叠加到 preset.regexScripts 之上 */
  regexScripts?: RegexScriptData[];
  /** 上一轮历史 / 当前 user input 也走这里。fast-tavern 原生 ChatMessage 形状 */
  history?: ChatMessage[];
  /**
   * Tsian 占位符（KV）。
   *
   * key 允许包含 `.` `:` 等字符（如 `globals.weather.kind`、`node:retrieval.events`）。
   * fast-tavern 的 `replaceMacros` 是纯字符串替换，不解析路径——路径取值由调用方先在外部拍平后注入。
   */
  macros: Record<string, string>;
  /**
   * 输出渠道。默认 `'openai'`。
   *
   * - `openai`：role/content 结构化数组，role: system/user/assistant
   * - `gemini`：role/parts 结构化数组，保留供 Google Gemini 等 parts 风格 API 与未来多模态出口使用
   * - `text`：合并为单条字符串（rendered 字段直接给字符串）
   * - `tagged`：调试用 TaggedContent 列表，保留 tag/target/historyDepth 元信息
   */
  channel?: 'openai' | 'text' | 'tagged' | 'gemini';
  /**
   * 正则视图过滤。默认 `'model'`。
   *
   * - `'model'`：仅应用 `view` 包含 `'model'` 的正则脚本——构建发送给 LLM 的 prompt（三段链主用例）
   * - `'user'`：仅应用 `view` 包含 `'user'` 的正则脚本——构建给玩家渲染的版本（模组/玩家自定义节点可能选这个）
   */
  view?: 'user' | 'model';
}

/**
 * Tsian 装配出参。
 *
 * - `messages`：按 `channel` 序列化后的最终消息列表
 *   - `openai` / `gemini`：`ChatMessage[]`
 *   - `text`：单条 `ChatMessage`，`content` 是合并后的字符串
 *   - `tagged`：`TaggedContent[]` 调试结构（不是标准 ChatMessage）
 * - `rendered`：调试用纯文本视图
 *   - `text` channel：直接是 channel 输出字符串
 *   - 其它 channel：`JSON.stringify(messages, null, 2)`
 */
export interface AssembleOutput {
  messages: ChatMessage[] | TaggedContent[];
  rendered: string;
}

/**
 * 装配 Tsian 提示词。
 *
 * 实现 = 包装 buildPrompt：
 * 1. 字段映射 AssembleInput → BuildPromptParams
 * 2. 调 buildPrompt 跑完整 pipeline（convert → assemble → macro → regex → channel-out）
 * 3. 从 `result.stages.output.afterPostRegex` 取最终序列化结果
 * 4. 按 channel 计算 rendered 字符串
 */
export function assemblePromptFromPreset(input: AssembleInput): AssembleOutput {
  const channel = input.channel ?? 'openai';
  const view = input.view ?? 'model';

  const result = buildPrompt({
    preset: input.preset,
    globals: {
      worldBooks: input.worldBooks,
      regexScripts: input.regexScripts,
    },
    history: input.history ?? [],
    macros: input.macros,
    view,
    outputFormat: channel,
  });

  const finalOutput = result.stages.output.afterPostRegex;

  if (channel === 'text') {
    // text channel：buildPrompt 在 outputFormat='text' 时给 string
    const text = finalOutput as unknown as string;
    return {
      messages: [{ role: 'user', parts: [{ text }] }],
      rendered: text,
    };
  }

  // openai / gemini / tagged：finalOutput 是 ChatMessage[] 或 TaggedContent[]
  const messages = finalOutput as ChatMessage[] | TaggedContent[];
  return {
    messages,
    rendered: JSON.stringify(messages, null, 2),
  };
}
