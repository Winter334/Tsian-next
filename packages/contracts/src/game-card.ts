export interface GameCardManifest {
  schema: "tsian.game-card.v1"
  id: string
  name: string
  version: string
  summary: string
  description?: string
  author?: GameCardAuthor
  cover?: GameCardCover
  frontend?: GameCardFrontendBinding
  assistant?: GameCardAssistant
}

export interface GameCardAuthor {
  name: string
  url?: string
}

export interface GameCardCover {
  url?: string
  workspacePath?: string
  alt?: string
}

export interface GameCardAssistant {
  agentId: string
  summary?: string
}

export type GameCardFrontendBinding =
  | {
      kind: "remote"
      url: string
      bridgeVersion: "tsian.play-bridge.v1"
    }
  | {
      kind: "packaged"
      entry: string
      bridgeVersion: "tsian.play-bridge.v1"
    }

export interface GameCardContentFile {
  path: string
  content: string
  mediaType?: string
}

export type GameCardWorkspaceTemplateFile = GameCardContentFile

export interface GameCardPackageFileEntry {
  path: string
  mediaType?: string
  size?: number
}

export interface GameCardPackageExporter {
  name: string
  version?: string
}

export interface GameCardPackageManifest {
  schema: "tsian.game-card.package.v1"
  manifest: GameCardManifest
  workspaceFiles?: GameCardPackageFileEntry[]
  frontendFiles?: GameCardPackageFileEntry[]
  coverFiles?: GameCardPackageFileEntry[]
  exportedAt?: string
  exporter?: GameCardPackageExporter
}
