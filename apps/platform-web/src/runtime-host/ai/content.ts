import type { AiChatMessage, ContentPart, RuntimeChatMessage } from "./types"

export function contentToTextPreview(content: string | ContentPart[]): string {
  if (typeof content === "string") return content
  return content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("")
}

export function contentImagePartCount(content: string | ContentPart[]): number {
  if (typeof content === "string") return 0
  return content.filter((part) => part.type === "image").length
}

/** Build OpenAI-native content: string → string, ContentPart[] → content blocks
 *  (text + image_url data URL). Used by openaiAdapter user/system branches. */
export function buildOpenAiContent(content: string | ContentPart[]): unknown {
  if (typeof content === "string") return content
  return content.map((part) => {
    if (part.type === "text") return { type: "text", text: part.text }
    return { type: "image_url", image_url: { url: `data:${part.mimeType};base64,${part.data}` } }
  })
}

/** Build Claude-native content: string → string, ContentPart[] → content blocks
 *  (text + image source base64). Used by claudeAdapter user branches. */
export function buildClaudeContent(content: string | ContentPart[]): unknown {
  if (typeof content === "string") return content
  return content.map((part) => {
    if (part.type === "text") return { type: "text", text: part.text }
    return { type: "image", source: { type: "base64", media_type: part.mimeType, data: part.data } }
  })
}

/** Build Gemini-native parts: string → [{text}], ContentPart[] →
 *  [{text} | {inlineData}]. Used by geminiAdapter user branches. */
export function buildGeminiParts(content: string | ContentPart[]): unknown[] {
  if (typeof content === "string") return [{ text: content }]
  return content.map((part) => {
    if (part.type === "text") return { text: part.text }
    return { inlineData: { mimeType: part.mimeType, data: part.data } }
  })
}

/** Build OpenAI Responses-native content blocks from Tsian text/image parts. */
export function buildResponsesContent(content: string | ContentPart[]): unknown {
  if (typeof content === "string") return content
  return content.map((part) => {
    if (part.type === "text") return { type: "input_text", text: part.text }
    return {
      type: "input_image",
      image_url: `data:${part.mimeType};base64,${part.data}`,
      detail: "auto",
    }
  })
}

/** Split OpenAI-style messages into a system prompt + non-system messages. */
export function splitSystemMessage(messages: AiChatMessage[]): { system: string | undefined; rest: AiChatMessage[] } {
  const systemParts: string[] = []
  const rest: AiChatMessage[] = []
  for (const message of messages) {
    if (message.role === "system") {
      if (message.content) {
        systemParts.push(contentToTextPreview(message.content))
      }
    } else {
      rest.push(message)
    }
  }
  return { system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined, rest }
}

/**
 * Split structured `RuntimeChatMessage[]` into a system prompt + the
 * non-system sequence (user/assistant/tool), preserving tool-call and tool-
 * observation payloads. Used by native adapters that carry a separate system
 * field (Gemini, Claude).
 */
export function splitSystemMessages(
  messages: RuntimeChatMessage[],
): { system: string | undefined; rest: RuntimeChatMessage[] } {
  const systemParts: string[] = []
  const rest: RuntimeChatMessage[] = []
  for (const message of messages) {
    if (message.role === "system") {
      if (message.content) {
        systemParts.push(contentToTextPreview(message.content))
      }
    } else {
      rest.push(message)
    }
  }
  return { system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined, rest }
}
