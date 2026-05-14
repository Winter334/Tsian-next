/**
 * apply-patch 节点 executor（design.md §13.1 / §13.3 / §13.9）
 *
 * 流程：
 *   1. 进入前检查 signal.aborted → 立即 throw（design §13.1：进入应用阶段后不再响应 abort）
 *   2. 从 inputs[config.patchVarName] 取 patch，校验为 non-null object（fail loud）
 *   3. 调 applyMaintenancePatch（runtime-host/patch-applier.ts）
 *   4. 把 ApplyPatchOutput 4 字段映射到 4 个固定端口名
 *
 * 端口（与 ApplyPatchOutput 对齐）：
 *   - appliedArchives: string[]
 *   - appliedEventIds: string[]   ← 当前 applier 永远返回 []，YAGNI；下游若需精确 ID 见 §13.3 注释
 *   - globalsChanged: boolean
 *   - currentTimeChanged: boolean
 *
 * 决策点 D5：不暴露 checkpointLabel 到 NodeConfig（applier 内部默认 `回合 ${turn}`）。
 */

import type { NodeExecutor } from "@tsian/workflow-engine"
import type {
  ApplyPatchNodeConfig,
  MaintenancePatchDocument,
} from "@tsian/contracts"
import { WorkflowAbortError } from "@tsian/workflow-engine"
import { applyMaintenancePatch } from "../../runtime-host/patch-applier"
import type { PlatformWorkflowContext } from "../types"

function readApplyPatchConfig(raw: unknown): ApplyPatchNodeConfig {
  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof (raw as { patchVarName?: unknown }).patchVarName !== "string"
  ) {
    throw new Error(
      `apply-patch node config is invalid: expected { patchVarName: string }`,
    )
  }
  return raw as ApplyPatchNodeConfig
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function castPlatformContext(raw: unknown): PlatformWorkflowContext {
  const ctx = raw as Partial<PlatformWorkflowContext>
  if (!ctx || !ctx.runtimeEngine || typeof ctx.saveId !== "string" || !ctx.saveId) {
    throw new Error(
      `apply-patch node requires PlatformWorkflowContext with runtimeEngine + saveId`,
    )
  }
  return ctx as PlatformWorkflowContext
}

function normalizePushReason(
  raw: string | undefined,
): "after-turn" | "manual" {
  if (raw === "after-turn" || raw === "manual") return raw
  return "after-turn"
}

export const applyPatchExecutor: NodeExecutor = {
  async execute({ node, inputs, signal, context }) {
    if (signal.aborted) {
      throw new WorkflowAbortError(
        `apply-patch node "${node.id}" aborted before applying`,
      )
    }

    const config = readApplyPatchConfig(node.config)
    const patch = inputs[config.patchVarName]
    if (!isPlainObject(patch)) {
      throw new Error(
        `apply-patch node "${node.id}" expected inputs["${config.patchVarName}"] to be a non-null object, got ${typeof patch}`,
      )
    }

    const ctx = castPlatformContext(context)
    const result = await applyMaintenancePatch({
      patch: patch as unknown as MaintenancePatchDocument,
      runtimeEngine: ctx.runtimeEngine,
      saveId: ctx.saveId,
      pushCheckpointReason: normalizePushReason(config.pushCheckpointReason),
    })

    return {
      outputs: {
        appliedArchives: result.appliedArchives,
        appliedEventIds: result.appliedEventIds,
        globalsChanged: result.globalsChanged,
        currentTimeChanged: result.currentTimeChanged,
      },
    }
  },
}
