import type { TurnToolOutput } from "@tsian/contracts"
import { compactLargeValueForModel } from "../tool-memory"
import {
  RUNTIME_WORKSPACE_TOOL_NAMES,
  type RuntimeWorkspaceToolCall,
  type RuntimeWorkspaceToolObservation,
} from "../workspace-tools-types"
import { isRecord } from "./shared"

/**
 * Build the `turn-tool` event output for a tool observation.
 *
 * - 普通工具：完整 `JSON.stringify(result)`（或 `String(result)`），**不截断**。
 *   截断/显示策略交给 UI 侧（前端按需折叠或不显 output）。
 *   返回 `undefined` 当 result 为空（事件省略 output）。
 * - agent_call：结构化对象 `{type:"agent_call", targetAgent, response, status}`，
 *   提取被调用 agent 的 title + 完整 response，让前端不用解析整坨 JSON。
 *   response 不截断（UI 侧控制长度）。
 *
 * **本函数只服务 UI/trace 旁路的 turn-tool 事件，给完整结果**（不截断，
 *  显示策略交给前端按需折叠）。喂回模型的路径在 text-tool-protocol 的
 *  Text Tool Protocol v2 observation formatter 和 `formatNativeToolObservationContent`，
 *  那里经 `compactToolObservationForModel` 对大结果做 preview+续读线索，
 *  与本旁路分离——debug/trace 保留完整事实，模型上下文只拿 compact 版。
 */
export function buildToolOutput(
  call: RuntimeWorkspaceToolCall | undefined,
  observation: RuntimeWorkspaceToolObservation,
): TurnToolOutput | undefined {
  const isAgentCall = call?.name === RUNTIME_WORKSPACE_TOOL_NAMES.agentCall

  // agent_call 结构化：成功提 targetAgent + response，失败提 error
  if (isAgentCall) {
    if (!observation.ok) {
      const err = observation.error
      return {
        type: "agent_call",
        targetAgent: { id: "", title: "" },
        response: "",
        status: "failed",
        ...(err ? { error: { code: err.code, message: err.message } } : {}),
      }
    }
    const result = isRecord(observation.result) ? observation.result : {}
    const targetAgent = isRecord(result.targetAgent) ? result.targetAgent : {}
    const response = typeof result.response === "string" ? result.response : ""
    return {
      type: "agent_call",
      targetAgent: {
        id: typeof targetAgent.id === "string" ? targetAgent.id : "",
        title: typeof targetAgent.title === "string" ? targetAgent.title : "",
        ...(typeof targetAgent.summary === "string" ? { summary: targetAgent.summary } : {}),
      },
      response,
      status: "completed",
    }
  }

  // 普通工具：完整 stringify，不截断
  if (observation.result === undefined) {
    return undefined
  }
  try {
    return typeof observation.result === "string"
      ? observation.result
      : JSON.stringify(observation.result)
  } catch {
    return undefined
  }
}

function compactUnknownResultForModel(result: unknown): unknown {
  return compactLargeValueForModel(result)
}

function compactToolErrorForModel(
  error: RuntimeWorkspaceToolObservation["error"],
): RuntimeWorkspaceToolObservation["error"] | undefined {
  if (!error) return undefined
  return {
    code: error.code,
    message: error.message,
    ...(error.details === undefined ? {} : { details: compactLargeValueForModel(error.details) }),
  }
}

export function compactToolObservationForModel(
  observation: RuntimeWorkspaceToolObservation,
): RuntimeWorkspaceToolObservation {
  // Keep text observation free of multimodal imageParts/base64. Images are
  // threaded through ContentPart[] separately by the caller.
  if (!observation.ok) {
    const error = compactToolErrorForModel(observation.error)
    return {
      index: observation.index,
      name: observation.name,
      ok: false,
      ...(error ? { error } : {}),
    }
  }
  return {
    index: observation.index,
    name: observation.name,
    ok: true,
    ...(observation.result === undefined ? {} : { result: compactUnknownResultForModel(observation.result) }),
  }
}

/**
 * Native 模式 tool message content：裸结果，无容器外壳/引导语。
 * toolCallId 已关联调用，index/name 冗余；provider native 训练分布直接放结果。
 * 成功：result 是 string 直放，否则 JSON.stringify(result)。
 * 失败：JSON.stringify(error)（保留 code + message + details）。
 */
export function formatNativeToolObservationContent(
  observation: RuntimeWorkspaceToolObservation,
): string {
  if (!observation.ok) {
    return JSON.stringify(
      compactToolErrorForModel(observation.error) ?? { code: "UNKNOWN", message: "Unknown error" },
    )
  }
  const result = compactUnknownResultForModel(observation.result)
  return typeof result === "string" ? result : JSON.stringify(result)
}
