import { shallowRef } from "vue"

export interface SpatialAssistantConfigSurfaceRequest {
  readonly onChange?: () => void
}

const activeRequest = shallowRef<SpatialAssistantConfigSurfaceRequest | null>(null)

export function openSpatialAssistantConfig(
  request: SpatialAssistantConfigSurfaceRequest = {},
): boolean {
  if (activeRequest.value) return false
  activeRequest.value = Object.freeze({ ...request })
  return true
}

export function useSpatialAssistantConfigState() {
  return activeRequest
}

export function notifySpatialAssistantConfigChanged(): void {
  activeRequest.value?.onChange?.()
}

export function closeSpatialAssistantConfig(): void {
  activeRequest.value = null
}
