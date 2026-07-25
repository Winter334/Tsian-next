import type { WorkspaceFile } from "@tsian/contracts"

const FRONTEND_ACTION_ROOT = "frontend-actions"

/**
 * Host-selected Workspace boundary for an Agent Runtime entry.
 *
 * The default is intentionally the lower-trust game-Agent boundary. Trusted
 * authoring is reserved for explicit platform-local assistant entry points;
 * delegated Agent steps must always downgrade to the runtime boundary.
 */
export type AgentWorkspaceTrustBoundary =
  | "runtime-game-agent"
  | "trusted-authoring"

export function isFrontendActionPath(path: string): boolean {
  return path === FRONTEND_ACTION_ROOT
    || path.startsWith(`${FRONTEND_ACTION_ROOT}/`)
}

export function withoutFrontendActionFiles(
  files: readonly WorkspaceFile[],
): WorkspaceFile[] {
  return files.filter((file) => !isFrontendActionPath(file.path))
}

export function workspaceFilesForAgentBoundary(
  files: readonly WorkspaceFile[],
  boundary: AgentWorkspaceTrustBoundary = "runtime-game-agent",
): WorkspaceFile[] {
  return boundary === "trusted-authoring"
    ? Array.from(files)
    : withoutFrontendActionFiles(files)
}

export function workspaceFileFilterForAgentBoundary(
  boundary: AgentWorkspaceTrustBoundary = "runtime-game-agent",
): ((file: WorkspaceFile) => boolean) | undefined {
  return boundary === "trusted-authoring"
    ? undefined
    : (file) => !isFrontendActionPath(file.path)
}
