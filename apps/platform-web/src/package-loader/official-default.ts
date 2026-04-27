import type { PlayFrontendBridge, PlayFrontendManifest } from "@tsian/contracts"
import {
  manifest,
  mountOfficialDefaultFrontend,
} from "../../../../builtin/play-frontends/official-default/src/index"

export interface LoadedBuiltinFrontend {
  manifest: PlayFrontendManifest
  mount(container: HTMLElement, bridge: PlayFrontendBridge): () => void
}

export function loadOfficialDefaultFrontend(): LoadedBuiltinFrontend {
  return {
    manifest,
    mount(container, bridge) {
      return mountOfficialDefaultFrontend(container, bridge)
    },
  }
}
