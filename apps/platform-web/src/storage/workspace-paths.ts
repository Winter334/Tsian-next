import { WorkspaceStorageError } from "./workspace-types"
import { normalizeWorkspacePath } from "@/lib/workspace-path"

export function normalizeDirectoryPath(value: unknown): string {
  const result = normalizeWorkspacePath(value ?? "", {
    allowEmpty: true,
    rejectTrailingSlash: false,
  })
  if (!result.ok) {
    throw new WorkspaceStorageError(result.code, result.message)
  }
  return result.path
}

export function normalizeWorkspaceFilePath(value: unknown): string {
  const result = normalizeWorkspacePath(value, {
    allowEmpty: false,
    rejectTrailingSlash: true,
  })
  if (!result.ok) {
    throw new WorkspaceStorageError(result.code, result.message)
  }
  return result.path
}

export function normalizeWorkspaceTargetPath(value: unknown): string {
  const result = normalizeWorkspacePath(value, {
    allowEmpty: false,
    rejectTrailingSlash: false,
  })
  if (!result.ok) {
    throw new WorkspaceStorageError(result.code, result.message)
  }
  return result.path
}

export function fileName(path: string): string {
  const parts = path.split("/")
  return parts[parts.length - 1] || path
}

export function isPlatformMetadataPath(path: string): boolean {
  return path === ".tsian" || path.startsWith(".tsian/")
}

export function isActiveSaveRuntimePath(path: string): boolean {
  return path === "save" || path.startsWith("save/")
}

export function isSaveRuntimePersistencePath(path: string): boolean {
  if (isActiveSaveRuntimePath(path)) {
    return true
  }
  // .tsian/local/ is local-only data excluded from save checkpoint/restore.
  if (path === ".tsian/local" || path.startsWith(".tsian/local/")) {
    return false
  }
  return isPlatformMetadataPath(path)
}

export function isOrdinaryWorkspacePath(path: string): boolean {
  return !isPlatformMetadataPath(path)
}

export function assertOrdinarySaveRuntimeMutationPath(path: string): void {
  if (isPlatformMetadataPath(path)) {
    throw new WorkspaceStorageError(
      "WORKSPACE_PLATFORM_METADATA_FORBIDDEN",
      "Platform metadata paths under .tsian are host-owned.",
    )
  }

  if (isActiveSaveRuntimePath(path)) {
    return
  }

  throw new WorkspaceStorageError(
    "WORKSPACE_SAVE_RUNTIME_PATH_REQUIRED",
    "Runtime workspace mutations must target the active save under save/.",
  )
}

export function assertOrdinaryReadPath(path: string): void {
  if (!isPlatformMetadataPath(path)) {
    return
  }

  throw new WorkspaceStorageError(
    "WORKSPACE_PLATFORM_METADATA_FORBIDDEN",
    "Platform metadata paths under .tsian are not available through ordinary workspace reads.",
  )
}

export function assertPlatformSaveRuntimeMutationPath(path: string): void {
  if (isSaveRuntimePersistencePath(path)) {
    return
  }

  throw new WorkspaceStorageError(
    "WORKSPACE_SAVE_RUNTIME_PATH_REQUIRED",
    "Platform runtime workspace mutations must target save/ or .tsian/.",
  )
}

