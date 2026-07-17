import type { WorkspaceFile } from "@tsian/contracts"
import type { RuntimeTraceEvent } from "../agent-runtime/trace"
import { serializeRuntimeTraceEvents } from "../agent-runtime/trace"
import {
  writePlatformWorkspaceFileForSave,
  type RuntimeWorkspaceTransaction,
} from "../storage"

function syncWorkspaceFileWrite(
  workspaceFiles: WorkspaceFile[],
  item: WorkspaceFile,
): void {
  const existingIndex = workspaceFiles.findIndex((file) => file.path === item.path)
  if (existingIndex >= 0) {
    workspaceFiles[existingIndex] = item
  } else {
    workspaceFiles.push(item)
    workspaceFiles.sort((left, right) => left.path.localeCompare(right.path))
  }
}

export async function writeRuntimeTraceFileForSave(
  saveId: string,
  workspaceFiles: WorkspaceFile[],
  path: string,
  events: RuntimeTraceEvent[],
): Promise<void> {
  const file = await writePlatformWorkspaceFileForSave(saveId, {
    path,
    content: serializeRuntimeTraceEvents(events),
  })
  syncWorkspaceFileWrite(workspaceFiles, file)
}

export function stageRuntimeTraceFile(
  workspaceTransaction: RuntimeWorkspaceTransaction,
  path: string,
  events: RuntimeTraceEvent[],
): WorkspaceFile {
  return workspaceTransaction.writePlatformFile({
    path,
    content: serializeRuntimeTraceEvents(events),
  })
}
