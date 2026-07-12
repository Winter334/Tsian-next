export type MarketResourceType = "game_card" | "agent" | "skill" | "tool"

export type AdminMarketVisibility = "all" | "visible" | "hidden"

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
  coverThumbUrl: string | null
  uploader: MarketPackageUploader
  downloadCount: number
  createdAt: string
  updatedAt: string
}

export interface MarketPackageListResponse {
  packages: MarketPackage[]
  nextCursor: string | null
}

export type MarketPackageCounts = Record<MarketResourceType, number>

export interface MarketPackageCountsResponse {
  counts: MarketPackageCounts
}

export interface AdminMarketPackage extends MarketPackage {
  hiddenAt: string | null
  hiddenBy: string | null
}

export interface AdminMarketPackageListResponse {
  packages: AdminMarketPackage[]
  nextCursor: string | null
}

export interface AdminMarketPackageUpdateRequest {
  name: string
  summary: string
  tags: string[]
}
