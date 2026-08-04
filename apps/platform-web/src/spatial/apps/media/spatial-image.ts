import { onBeforeUnmount, shallowRef, toValue, watch, type MaybeRefOrGetter } from "vue"
import type { LocalGameCardRecord } from "@/storage/db"
import type { LocalGameCardContentFile } from "@/storage/game-cards"

export type SpatialImageInput =
  | { kind: "none" }
  | { kind: "url"; url: string }
  | { kind: "blob"; blob: Blob }

export type SpatialImageState =
  | { status: "empty" }
  | { status: "loading" }
  | { status: "ready"; url: string }
  | { status: "unavailable"; reason: "load" | "cors" | "invalid" }

export interface SpatialImageResolverEnvironment {
  baseUrl?: string
  fetch?: typeof globalThis.fetch
  createObjectURL?: (blob: Blob) => string
  revokeObjectURL?: (url: string) => void
}

export class SpatialImageResolver {
  state: SpatialImageState = { status: "empty" }
  private readonly environment: Required<SpatialImageResolverEnvironment>
  private requestToken = 0
  private abortController: AbortController | null = null
  private ownedUrl = ""

  constructor(
    environment: SpatialImageResolverEnvironment = {},
    private readonly onStateChange: (state: SpatialImageState) => void = () => undefined,
  ) {
    this.environment = {
      baseUrl: environment.baseUrl ?? globalThis.location?.href ?? "http://localhost/",
      fetch: environment.fetch ?? globalThis.fetch.bind(globalThis),
      createObjectURL: environment.createObjectURL ?? URL.createObjectURL.bind(URL),
      revokeObjectURL: environment.revokeObjectURL ?? URL.revokeObjectURL.bind(URL),
    }
  }

  async resolve(input: SpatialImageInput): Promise<void> {
    const token = ++this.requestToken
    this.abortController?.abort()
    this.abortController = null
    this.releaseOwnedUrl()

    if (input.kind === "none") {
      this.setState({ status: "empty" })
      return
    }
    if (input.kind === "blob") {
      this.ownedUrl = this.environment.createObjectURL(input.blob)
      this.setState({ status: "ready", url: this.ownedUrl })
      return
    }

    const rawUrl = input.url.trim()
    if (!rawUrl) {
      this.setState({ status: "empty" })
      return
    }

    let resolved: URL
    let base: URL
    try {
      base = new URL(this.environment.baseUrl)
      resolved = new URL(rawUrl, base)
    } catch {
      this.setState({ status: "unavailable", reason: "invalid" })
      return
    }

    if (resolved.protocol === "blob:" || resolved.origin === base.origin) {
      this.setState({ status: "ready", url: rawUrl })
      return
    }
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
      this.setState({ status: "unavailable", reason: "invalid" })
      return
    }

    const controller = new AbortController()
    this.abortController = controller
    this.setState({ status: "loading" })
    try {
      const response = await this.environment.fetch(resolved.href, { mode: "cors", signal: controller.signal })
      if (!response.ok) throw new Error(`Image request failed with ${response.status}.`)
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? ""
      if (!contentType.startsWith("image/")) {
        if (token === this.requestToken) this.setState({ status: "unavailable", reason: "invalid" })
        return
      }
      const blob = await response.blob()
      if (token !== this.requestToken) return
      this.ownedUrl = this.environment.createObjectURL(blob)
      this.setState({ status: "ready", url: this.ownedUrl })
    } catch (error) {
      if (token !== this.requestToken || controller.signal.aborted) return
      this.setState({ status: "unavailable", reason: "cors" })
    } finally {
      if (this.abortController === controller) this.abortController = null
    }
  }

  markLoadFailure(): void {
    ++this.requestToken
    this.abortController?.abort()
    this.abortController = null
    this.releaseOwnedUrl()
    this.setState({ status: "unavailable", reason: "load" })
  }

  dispose(): void {
    ++this.requestToken
    this.abortController?.abort()
    this.abortController = null
    this.releaseOwnedUrl()
  }

  private releaseOwnedUrl(): void {
    if (!this.ownedUrl) return
    this.environment.revokeObjectURL(this.ownedUrl)
    this.ownedUrl = ""
  }

  private setState(state: SpatialImageState): void {
    this.state = state
    this.onStateChange(state)
  }
}

export function useSpatialImage(input: MaybeRefOrGetter<SpatialImageInput>) {
  const state = shallowRef<SpatialImageState>({ status: "empty" })
  const resolver = new SpatialImageResolver({}, (next) => {
    state.value = next
  })
  watch(() => toValue(input), (next) => void resolver.resolve(next), { immediate: true, deep: true })
  onBeforeUnmount(() => resolver.dispose())
  return { state, markLoadFailure: () => resolver.markLoadFailure() }
}

export function spatialImageInputForGameCard(
  card: (LocalGameCardRecord & { coverContentFile?: LocalGameCardContentFile }) | null | undefined,
): SpatialImageInput {
  if (!card) return { kind: "none" }
  if (card.coverContentFile?.data) return { kind: "blob", blob: card.coverContentFile.data }
  const url = card.manifest.cover?.url?.trim()
  return url ? { kind: "url", url } : { kind: "none" }
}
