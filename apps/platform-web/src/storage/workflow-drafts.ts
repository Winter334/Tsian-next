import type { WorkflowDefinition } from "@tsian/contracts"
import { localDb } from "./db"

export interface LocalWorkflowDraft {
  modId: string
  definition: WorkflowDefinition
  updatedAt: number
}

const WORKFLOW_DRAFT_KEY_PREFIX = "workflow-draft:"

function workflowDraftKey(modId: string): string {
  return `${WORKFLOW_DRAFT_KEY_PREFIX}${modId}`
}

export async function getWorkflowDraft(modId: string): Promise<LocalWorkflowDraft | null> {
  const record = await localDb.meta.get(workflowDraftKey(modId))
  if (!record) {
    return null
  }

  return JSON.parse(record.value) as LocalWorkflowDraft
}

export async function saveWorkflowDraft(
  modId: string,
  definition: WorkflowDefinition,
): Promise<LocalWorkflowDraft> {
  const draft: LocalWorkflowDraft = {
    modId,
    definition,
    updatedAt: Date.now(),
  }

  await localDb.meta.put({
    key: workflowDraftKey(modId),
    value: JSON.stringify(draft),
  })

  return draft
}

export async function deleteWorkflowDraft(modId: string): Promise<void> {
  await localDb.meta.delete(workflowDraftKey(modId))
}
