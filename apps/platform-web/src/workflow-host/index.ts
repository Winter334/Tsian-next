/**
 * workflow-host 入口：构造 PlatformWorkflowContext。
 *
 * H4 范围：仅暴露工厂函数 createWorkflowExecutionContext。每轮 sendMessage 入口新建。
 * H8 改写 platform-host 时由 platform-host 调用本工厂；当前未接入主链。
 */

import type { NodeExecutor } from "@tsian/workflow-engine"
import {
  type CreateWorkflowExecutionContextInput,
  type PlatformWorkflowContext,
} from "./types"
import { aiCallExecutor } from "./executors/ai-call"
import { applyPatchExecutor } from "./executors/apply-patch"
import { computeExecutor } from "./executors/compute"
import { resultExecutor } from "./executors/result"
import { switchExecutor } from "./executors/switch"

function buildBuiltinExecutors(): ReadonlyMap<string, NodeExecutor> {
  return new Map<string, NodeExecutor>([
    ["ai-call", aiCallExecutor],
    ["result", resultExecutor],
    ["switch", switchExecutor],
    ["apply-patch", applyPatchExecutor],
    ["compute", computeExecutor],
  ])
}

export function createWorkflowExecutionContext(
  input: CreateWorkflowExecutionContextInput,
): PlatformWorkflowContext {
  return {
    executors: buildBuiltinExecutors(),
    runtimeEngine: input.runtimeEngine,
    saveId: input.saveId,
    macros: input.macros,
    presets: input.presets,
    worldBooks: input.worldBooks,
    history: input.history,
  }
}

export type {
  PlatformWorkflowContext,
  CreateWorkflowExecutionContextInput,
  WorkflowPresetEntry,
  WorkflowWorldBookMap,
} from "./types"
