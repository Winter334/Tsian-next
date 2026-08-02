export interface SpatialShellFallback {
  readonly code: "runtime-capability" | "renderer" | "device-eligibility"
  readonly message: string
}
