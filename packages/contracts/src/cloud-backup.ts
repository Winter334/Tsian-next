export interface CloudBackupFileEntry {
  path: string
  hash: string
  size: number
  mediaType: string
  kind: "text" | "binary"
  createdAt: number
  updatedAt: number
}

export interface CloudBackupSummary {
  id: string
  name: string
  cardId: string
  cardVersion: string
  revisionId: string
  sizeBytes: number
  fileCount: number
  createdAt: string
  updatedAt: string
}

export interface CloudBackupListResponse {
  backups: CloudBackupSummary[]
  usageBytes: number
  quotaBytes: number
}

export interface CloudBackupPrepareRequest {
  backupId?: string
  expectedRevisionId?: string | null
  force?: boolean
  name: string
  cardId: string
  cardVersion: string
  files: CloudBackupFileEntry[]
}

export interface CloudBackupPrepareResponse {
  backupId: string
  missingHashes: string[]
  usageBytesAfterCommit: number
  quotaBytes: number
}

export interface CloudBackupCommitRequest extends CloudBackupPrepareRequest {
  backupId: string
}

export interface CloudBackupManifestResponse extends CloudBackupSummary {
  files: CloudBackupFileEntry[]
}
