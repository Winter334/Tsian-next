export const WORKSPACE_CONTENT_CHANGED_EVENT = "tsian:workspace-content-changed"

export interface WorkspaceContentChangedDetail {
  cardId: string
  path: string
}

export function emitWorkspaceContentChanged(detail: WorkspaceContentChangedDetail): void {
  window.dispatchEvent(new CustomEvent<WorkspaceContentChangedDetail>(
    WORKSPACE_CONTENT_CHANGED_EVENT,
    { detail },
  ))
}

export function isWorkspaceContentChangedEvent(
  event: Event,
): event is CustomEvent<WorkspaceContentChangedDetail> {
  if (event.type !== WORKSPACE_CONTENT_CHANGED_EVENT || !(event instanceof CustomEvent)) {
    return false
  }

  return typeof event.detail?.cardId === "string"
    && typeof event.detail.path === "string"
}
