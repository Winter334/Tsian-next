export type MarketResourceType = "game_card" | "agent" | "skill"

export interface MarketPackageUploader {
  id: string
  displayName: string
  avatarUrl: string | null
}

export interface MarketPackage {
  id: string
  resourceType: MarketResourceType
  resourceId: string
  resourceAuthor: string
  resourceVersion: string
  name: string
  summary: string
  tags: string[]
  coverUrl: string | null
  uploader: MarketPackageUploader
  downloadCount: number
  createdAt: string
}
