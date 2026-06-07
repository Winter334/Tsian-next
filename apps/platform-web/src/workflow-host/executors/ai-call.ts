/**
 * ai-call 节点 executor
 *
 * 流程：
 *   1. 从 context.presets 取 PresetInfo（缺失 → fail loud throw）
 *   2. 按 config.worldBookKeys 过滤 context.worldBooks（未声明 = 全集）
 *   3. 合并宏：context.macros ∪ inputs（inputs 同名覆盖 macros；结构化 inputs 额外展开路径宏）
 *   4. 调 assemblePromptFromPreset（channel='openai', view='model'）
 *   5. 若 config.appendUserInput === true：把 { role: 'user', content: macros['user.input'] } 追加到末尾
 *   6. 调 generateAssistantReply(messages, { signal, debugLabel })
 *   7. 按 node.outputs[] 的 extract 规则切端口；默认 outputs.raw 始终携带原始文本
 *
 * 决策点 D1：直接 inline 调 generateAssistantReply，不抽 callChannel 公共层。
 * 决策点 D2：assemblePromptFromPreset(channel='openai') 出口已经是 { role, content } 形态
 *           （core/channels/openai.ts fromInternalToOpenAI），无需再加 toOpenAIChatMessages。
 */

import type { NodeExecutor } from "@tsian/workflow-engine"
import type {
  AiCallNodeConfig,
  NodeOutputDeclaration,
  NodeOutputExtractRule,
} from "@tsian/contracts"
import {
  assemblePromptFromPreset,
  type ChatMessage as PromptChatMessage,
  type PresetInfo,
  type WorldBook,
} from "@tsian/prompt-engine"
import type { AiChatMessage } from "../../runtime-host/ai"
import { generateAssistantReply } from "../../runtime-host/ai"
import type { PlatformWorkflowContext } from "../types"

function readAiCallConfig(raw: unknown): AiCallNodeConfig {
  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof (raw as { presetId?: unknown }).presetId !== "string"
  ) {
    throw new Error(`ai-call node config is invalid: expected { presetId: string }`)
  }
  return raw as AiCallNodeConfig
}

function castPlatformContext(raw: unknown): PlatformWorkflowContext {
  const ctx = raw as Partial<PlatformWorkflowContext>
  if (
    !ctx ||
    !(ctx.presets instanceof Map) ||
    typeof ctx.macros !== "object" ||
    ctx.macros === null
  ) {
    throw new Error(
      `ai-call node requires PlatformWorkflowContext with presets(Map) + macros`,
    )
  }
  return ctx as PlatformWorkflowContext
}

function selectWorldBooks(
  context: PlatformWorkflowContext,
  keys: string[] | undefined,
): WorldBook[] {
  const all = context.worldBooks as Record<string, unknown>
  const list: WorldBook[] = []
  if (!keys || keys.length === 0) {
    for (const value of Object.values(all)) {
      if (value && typeof value === "object") list.push(value as WorldBook)
    }
    return list
  }
  for (const key of keys) {
    const wb = all[key]
    if (wb && typeof wb === "object") list.push(wb as WorldBook)
  }
  return list
}

function inputsToMacros(inputs: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(inputs)) {
    out[k] = stringifyMacroValue(v)
    flattenInputMacroPaths(out, k, v)
  }
  return out
}

function stringifyMacroValue(value: unknown): string {
  if (typeof value === "string") return value
  if (value === undefined || value === null) return ""
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function isTraversable(value: unknown): value is Record<string, unknown> | unknown[] {
  return typeof value === "object" && value !== null
}

function flattenInputMacroPaths(
  out: Record<string, string>,
  prefix: string,
  value: unknown,
): void {
  const seen = new WeakSet<object>()
  let emitted = 0
  const maxEntries = 500
  const maxDepth = 6

  function visit(currentPrefix: string, current: unknown, depth: number): void {
    if (!isTraversable(current) || depth >= maxDepth || emitted >= maxEntries) return
    if (seen.has(current)) return
    seen.add(current)

    const entries = Array.isArray(current)
      ? current.map((item, index) => [String(index), item] as const)
      : Object.entries(current)

    for (const [key, child] of entries) {
      if (!key || emitted >= maxEntries) continue
      const nextPrefix = `${currentPrefix}.${key}`
      out[nextPrefix] = stringifyMacroValue(child)
      emitted += 1
      visit(nextPrefix, child, depth + 1)
    }
  }

  visit(prefix, value, 0)
}

function toAiChatMessages(
  messages: ReadonlyArray<unknown>,
): AiChatMessage[] {
  const result: AiChatMessage[] = []
  for (const m of messages) {
    if (typeof m !== "object" || m === null) continue
    const obj = m as { role?: unknown; content?: unknown; parts?: unknown }
    let content = ""
    if (typeof obj.content === "string") {
      content = obj.content
    } else if (Array.isArray(obj.parts)) {
      content = obj.parts
        .map((p) =>
          p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string"
            ? (p as { text: string }).text
            : "",
        )
        .join("")
    }
    const rawRole = String(obj.role ?? "user")
    const role: AiChatMessage["role"] =
      rawRole === "system" || rawRole === "user" || rawRole === "assistant"
        ? rawRole
        : rawRole === "model"
          ? "assistant"
          : "user"
    result.push({ role, content })
  }
  return result
}

// ── 输出端口提取 ────────────────────────────────────────────────────────────

function extractByTag(text: string, tag: string): string {
  // 贪婪到最近的 </tag>：用非贪婪 .*? + 第一个匹配
  const re = new RegExp(`<${escapeRe(tag)}>([\\s\\S]*?)<\\/${escapeRe(tag)}>`)
  const m = text.match(re)
  if (!m) {
    throw new Error(`ai-call output: tag <${tag}> not found in response`)
  }
  return m[1] ?? ""
}

function extractByRegex(
  text: string,
  pattern: string,
  flags: string | undefined,
  group: number | undefined,
): string {
  const re = new RegExp(pattern, flags)
  const m = text.match(re)
  if (!m) {
    throw new Error(`ai-call output: regex ${pattern} did not match`)
  }
  const idx = group ?? 0
  if (idx < 0 || idx >= m.length) {
    throw new Error(`ai-call output: regex group ${idx} out of range`)
  }
  return m[idx] ?? ""
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function applyParse(
  value: string,
  parse: "json" | "number" | undefined,
): unknown {
  if (parse === "json") {
    try {
      return JSON.parse(value)
    } catch (err) {
      throw new Error(
        `ai-call output: JSON.parse failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
  if (parse === "number") {
    const n = Number(value)
    if (!Number.isFinite(n)) {
      throw new Error(`ai-call output: Number(${JSON.stringify(value)}) is not finite`)
    }
    return n
  }
  return value
}

function extractPort(rule: NodeOutputExtractRule, raw: string): unknown {
  if (rule.type === "raw") {
    return applyParse(raw, rule.parse)
  }
  if (rule.type === "tag") {
    return applyParse(extractByTag(raw, rule.tag), rule.parse)
  }
  if (rule.type === "regex") {
    return applyParse(
      extractByRegex(raw, rule.pattern, rule.flags, rule.group),
      rule.parse,
    )
  }
  throw new Error(
    `ai-call output: unknown extract rule type "${(rule as { type?: string }).type}"`,
  )
}

// ── executor ────────────────────────────────────────────────────────────────

export const aiCallExecutor: NodeExecutor = {
  async execute({ node, inputs, signal, context }) {
    const config = readAiCallConfig(node.config)
    const ctx = castPlatformContext(context)

    // 宏合并：平台 macros 在前，inputs 同名覆盖。
    const macros: Record<string, string> = {
      ...ctx.macros,
      ...inputsToMacros(inputs),
    }

    // H8 β-1 旁路：跳过 preset / prompt-engine / ai fetch / ai-debug；直接从 macro 读取 raw。
    // 复用 outputs.extract 逻辑（如 directEntities tag 解析）。H10 retrieval 下沉后应删除本分支。
    if (config.bypass) {
      const rawFromMacroKey = config.bypass.rawFromMacro
      const rawCandidate = macros[rawFromMacroKey]
      if (typeof rawCandidate !== "string") {
        throw new Error(
          `ai-call node "${node.id}" bypass.rawFromMacro="${rawFromMacroKey}" not found in macros or not a string`,
        )
      }
      const raw = rawCandidate
      const outputs: Record<string, unknown> = { raw }
      const declarations: NodeOutputDeclaration[] = node.outputs ?? []
      for (const decl of declarations) {
        outputs[decl.name] = extractPort(decl.extract, raw)
      }
      return { outputs }
    }

    const preset = ctx.presets.get(config.presetId) as PresetInfo | undefined
    if (!preset) {
      throw new Error(
        `ai-call node "${node.id}": preset "${config.presetId}" not found in context.presets`,
      )
    }

    const worldBooks = selectWorldBooks(ctx, config.worldBookKeys)

    const assembled = assemblePromptFromPreset({
      preset,
      worldBooks,
      history: ctx.history as PromptChatMessage[],
      macros,
      channel: "openai",
      view: "model",
    })

    const aiMessages = toAiChatMessages(
      assembled.messages as unknown as ReadonlyArray<unknown>,
    )

    if (config.appendUserInput === true) {
      const userInput = ctx.macros["user.input"] ?? ""
      aiMessages.push({ role: "user", content: userInput })
    }

    const raw = await generateAssistantReply(aiMessages, {
      debugLabel: `${node.id}:${config.presetId}`,
      signal,
    })

    const outputs: Record<string, unknown> = { raw }
    const declarations: NodeOutputDeclaration[] = node.outputs ?? []
    for (const decl of declarations) {
      // 不覆盖 raw 端口除非用户显式声明
      outputs[decl.name] = extractPort(decl.extract, raw)
    }

    return { outputs }
  },
}
