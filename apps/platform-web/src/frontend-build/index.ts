// frontend-build — platform-side build service for game card frontends.
// Compiles frontend/src/** (source) → frontend/dist/** (build output) via
// esbuild-wasm in the browser. See task 06-30-platform-frontend-build-service.

export type { FrontendBuildStatus } from "./build-status"
export {
  getFrontendBuildStatus,
  setFrontendBuildBuilding,
  setFrontendBuildOk,
  setFrontendBuildFailed,
} from "./build-status"

export { buildFrontend, ensureEsbuildInitialized } from "./engine"
export type { BuildFrontendResult } from "./engine"
