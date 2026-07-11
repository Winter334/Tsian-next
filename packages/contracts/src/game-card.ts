export interface GameCardManifest {
  schema: "tsian.game-card.v1"
  id: string
  name: string
  version: string
  summary: string
  author?: GameCardAuthor
  cover?: GameCardCover
  frontend?: GameCardFrontendBinding
  runtime?: GameCardRuntimeConfig
}

export interface GameCardRuntimeConfig {
  entrypoints?: GameCardRuntimeEntrypoints
}

export interface GameCardRuntimeEntrypoints {
  /** Agent id used by tsian.send() / interaction.sendMessage formal player turns. */
  playerTurn?: string
  /**
   * Agent id invoked by the default novel frontend after each player turn's
   * prose is finalized, to perform runtime/entity/scene/memory/status bar
   * maintenance. Omit to disable post-turn sync (no Toast, no invokeAgent).
   *
   * The frontend reads this via the bridge (tsian.card.entrypoints()) and
   * calls invokeAgent with this id; it never hardcodes an agent name. Toast
   * labels describe the phase behavior and never reference this id or any
   * agent title, so renaming the agent only touches the card template.
   */
  postTurnMaintenance?: string
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

export const FRONTEND_FRAMEWORKS = [
  "vue",
  "react",
  "preact",
  "svelte",
  "vanilla",
] as const

export type FrontendFramework = (typeof FRONTEND_FRAMEWORKS)[number]

export type GameCardFrontendBinding =
  | {
      kind: "remote"
      url: string
      bridgeVersion: "tsian.play-bridge.v1"
    }
  | {
      kind: "packaged"
      entry: string
      /** Frontend source framework; drives platform build plugin + import map. Optional for backward compat — legacy cards without `frontend/src/` omit it. */
      framework?: FrontendFramework
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

export const FRONTEND_PACKAGE_SCHEMA = "tsian.frontend-package.v1"

export interface FrontendPackageFileEntry {
  path: string
  mediaType: string
  size: number
}

export interface FrontendPackageManifest {
  schema: typeof FRONTEND_PACKAGE_SCHEMA
  /** Package-root-relative entry path without a leading slash or frontend/ prefix. Must exist in files for dist packages; source packages may generate it during import-time build. */
  entry: string
  /** Frontend source framework; used when a package carries frontend/src/** sources that need platform online build. */
  framework?: FrontendFramework
  bridgeVersion: "tsian.play-bridge.v1"
  files: FrontendPackageFileEntry[]
  exportedAt?: string
  exporter?: GameCardPackageExporter
}
