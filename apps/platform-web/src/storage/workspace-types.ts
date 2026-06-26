import type { WorkspaceFile } from "@tsian/contracts"
import type { LocalWorkspaceFileRecord } from "./db"

export type CheckpointWorkspaceFile = Omit<LocalWorkspaceFileRecord, "id" | "saveId">

export interface WorkspaceListInput {
  path?: unknown
}

export interface WorkspaceWriteInput {
  path?: unknown
  /** Text content (string) or binary payload (Blob). One or the other. */
  content?: unknown
  data?: unknown
}

export interface RuntimeWorkspaceTransaction {
  readonly workspaceFiles: WorkspaceFile[]
  write(input: WorkspaceWriteInput): WorkspaceFile
  writePlatformFile(input: WorkspaceWriteInput): WorkspaceFile
  delete(path: unknown): { deletedPaths: string[] }
  finalWorkspaceFiles(): WorkspaceFile[]
  discard(): void
}

export class WorkspaceStorageError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "WorkspaceStorageError"
  }
}
