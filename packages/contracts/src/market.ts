export type MarketResourceType = "game_card"

export interface MarketPackageUploader {
  id: string
  displayName: string
  avatarUrl: string | null
}

export interface MarketPackage {
  id: string
  resourceType: MarketResourceType
  cardId: string
  cardAuthor: string
  cardVersion: string
  name: string
  summary: string
  coverUrl: string | null
  uploader: MarketPackageUploader
  downloadCount: number
  createdAt: string
}
