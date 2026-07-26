import type { JsonValue, WorkspaceFile } from "@tsian/contracts"
import actionManifest from "../../../../../cards/沉浸阅读器.tsian-card/workspace/frontend-actions/equipment/action.json?raw"
import actionCore from "../../../../../cards/沉浸阅读器.tsian-card/workspace/frontend-actions/equipment/equipment-core.js?raw"
import actionRun from "../../../../../cards/沉浸阅读器.tsian-card/workspace/frontend-actions/equipment/run.js?raw"
import { FrontendActionDomainError } from "../frontend-actions/errors"
import { validateAndInlineFrontendActionImports } from "../frontend-actions/imports"
import { resolveFrontendAction } from "../frontend-actions/registry"
import { runFrontendActionWorker } from "../frontend-actions/worker"

export interface EquipmentWorkerTransportPreflightResult {
  equipmentDomainErrorTransported: true
  equipmentBusinessFailureWrites: 0
}

const ACTION_INPUT = {
  mode: "commit",
  operation: "equip",
  characterRef: "character:hero",
  slotType: "武器",
  slotIndex: 0,
  expectedCurrentRef: null,
  itemRef: "item:new",
} as const satisfies JsonValue

const CHARACTER_PATH = "save/entities/character/hero.json"
const CHARACTER_FILE = {
  path: CHARACTER_PATH,
  content: `${JSON.stringify({
    id: "character:hero",
    name: "Hero",
    brief: "Worker transport fixture",
    attributes: { 力量: 5 },
    containers: [],
    equipment: { 武器: [{ ref: "item:old" }] },
  }, null, 2)}\n`,
  createdAt: 1,
  updatedAt: 1,
} satisfies JsonValue

function resource(path: string, content: string): WorkspaceFile {
  return { path, content, createdAt: 1, updatedAt: 1 }
}

export async function runEquipmentWorkerTransportPreflight(): Promise<EquipmentWorkerTransportPreflightResult> {
  const action = resolveFrontendAction({
    gameCardId: "equipment-worker-preflight",
    actionId: "equipment",
    files: [
      resource("frontend-actions/equipment/action.json", actionManifest),
      resource("frontend-actions/equipment/equipment-core.js", actionCore),
      resource("frontend-actions/equipment/run.js", actionRun),
    ],
  })
  const inputValidation = action.inputValidator.validate(ACTION_INPUT)
  if (!inputValidation.ok) throw new Error("Equipment Worker preflight input is invalid.")

  const source = validateAndInlineFrontendActionImports(action).source
  let writeCount = 0
  try {
    await runFrontendActionWorker({
      invocationId: "equipment-worker-transport-preflight",
      source,
      input: ACTION_INPUT,
      timeoutMs: 5_000,
      handleSdkRequest: async ({ op, args }) => {
        if (
          op === "workspace.read"
          && args !== null
          && typeof args === "object"
          && !Array.isArray(args)
          && (args as Record<string, unknown>).path === CHARACTER_PATH
        ) {
          return CHARACTER_FILE
        }
        if (op === "workspace.write") {
          writeCount += 1
          return { scope: "save-runtime", path: CHARACTER_PATH }
        }
        throw new Error(`Equipment Worker preflight made an unexpected SDK request: ${op}.`)
      },
    })
    throw new Error("Equipment Worker preflight unexpectedly succeeded.")
  } catch (error) {
    if (writeCount !== 0) throw new Error("Equipment business failure staged a Workspace write.")
    if (!(error instanceof FrontendActionDomainError)) throw error
    if (error.publicError.code !== "EQUIPMENT_EXPECTED_REF_MISMATCH") {
      throw new Error(`Equipment Worker preflight returned an unexpected domain code: ${error.publicError.code}.`)
    }
  }

  return {
    equipmentDomainErrorTransported: true,
    equipmentBusinessFailureWrites: 0,
  }
}
