import type { BrowserAiConfig } from "../../config/ai"
import type { ToolSchema } from "../../agent-runtime/tool-schemas"

import { generateAssistantReplyNative } from "./calls"
import type { NativeToolCallingProbeResult } from "./types"

const TOOL_CALL_PROBE_NAME = "tsian_tool_probe"
const TOOL_CALL_PROBE_TOOL: ToolSchema = {
  name: TOOL_CALL_PROBE_NAME,
  description: "Probe whether this model can call tools.",
  parameters: {
    type: "object",
    required: ["ping"],
    properties: {
      ping: {
        type: "string",
        description: "A short ping value.",
      },
    },
  },
}

function classifyNativeToolProbeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/401|403|api key|apikey|unauthori[sz]ed|forbidden|permission|鉴权|密钥/i.test(message)) {
    return `鉴权失败：${message}`
  }
  if (/tool|function|schema|tool_choice|toolchoice|toolConfig|functionCalling/i.test(message)) {
    return `API 拒绝工具调用参数：${message}`
  }
  if (/timeout|timed out|network|fetch|超时|网络/i.test(message)) {
    return `网络或接口超时：${message}`
  }
  return `原生工具调用测试失败：${message}`
}

export async function probeAssistantNativeToolCalling(
  config: BrowserAiConfig,
  options: { signal?: AbortSignal } = {},
): Promise<NativeToolCallingProbeResult> {
  try {
    const result = await generateAssistantReplyNative(
      [
        {
          role: "user",
          content: `Call the ${TOOL_CALL_PROBE_NAME} tool now with {"ping":"pong"}. Do not answer in text.`,
        },
      ],
      {
        config: { ...config, toolCallMode: "native", streaming: false },
        debugLabel: "settings-tool-probe",
        signal: options.signal,
        tools: [TOOL_CALL_PROBE_TOOL],
        forceToolName: TOOL_CALL_PROBE_NAME,
      },
    )

    if (result.toolCalls.some((call) => call.name === TOOL_CALL_PROBE_NAME)) {
      return { ok: true, message: "支持原生工具调用。" }
    }
    if (result.toolCalls.length > 0) {
      return {
        ok: false,
        message: `API 返回了工具调用，但不是测试工具（${result.toolCalls.map((call) => call.name).join(", ")}）。`,
      }
    }
    return {
      ok: false,
      message: "API 返回了普通回复，但没有发起工具调用。",
    }
  } catch (error) {
    return { ok: false, message: classifyNativeToolProbeError(error) }
  }
}
