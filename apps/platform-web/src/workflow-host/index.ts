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
import { computeExecutor } from "./executors/compute"
import { memoryQueryExecutor } from "./executors/memory-query"
import { recordFilterExecutor } from "./executors/record-filter"
import { recordFormatExecutor } from "./executors/record-format"
import { recordMergeExecutor } from "./executors/record-merge"
import { resultExecutor } from "./executors/result"
import { stateWriteExecutor } from "./executors/state-write"
import { switchExecutor } from "./executors/switch"
import { templateComposeExecutor } from "./executors/template-compose"

function buildBuiltinExecutors(): ReadonlyMap<string, NodeExecutor> {
  return new Map<string, NodeExecutor>([
    ["ai-call", aiCallExecutor],
    ["result", resultExecutor],
    ["switch", switchExecutor],
    ["compute", computeExecutor],
    ["memory-query", memoryQueryExecutor],
    ["state-write", stateWriteExecutor],
    ["template-compose", templateComposeExecutor],
    ["record-filter", recordFilterExecutor],
    ["record-merge", recordMergeExecutor],
    ["record-format", recordFormatExecutor],
  ])
}

export function createWorkflowExecutionContext(
  input: CreateWorkflowExecutionContextInput,
): PlatformWorkflowContext {
  return {
    executors: buildBuiltinExecutors(),
    runtimeEngine: input.runtimeEngine,
    saveId: input.saveId,
    turn: input.turn,
    macros: input.macros,
    presets: input.presets,
    worldBooks: input.worldBooks,
    history: input.history,
    userInput: input.userInput,
    events: input.events,
    activeEvents: input.activeEvents,
    archives: input.archives,
    catalogEvents: input.catalogEvents,
    currentTime: input.currentTime,
    narrativeTimeText: input.narrativeTimeText,
    globals: input.globals,
    playerArchiveIds: input.playerArchiveIds,
    retrievalSettings: input.retrievalSettings,
    recordRetrievalDebug: input.recordRetrievalDebug,
  }
}

export type {
  PlatformWorkflowContext,
  CreateWorkflowExecutionContextInput,
  WorkflowPresetEntry,
  WorkflowWorldBookMap,
} from "./types"
