import type {
  MountedRemoteIframeFrontend,
  RemoteBridgeActivityEntry,
  RemoteIframeMountStatus,
} from "./remote-iframe-bridge"

export interface ReadonlyMountedRemoteIframeFrontend {
  readonly iframe: HTMLIFrameElement
  readonly sessionId: string
  readonly status: RemoteIframeMountStatus
  readonly activitySequence: number
  readonly inFlightRequestCount: number
  readonly lastActivityAt: number | null
  subscribeStatus(listener: (status: RemoteIframeMountStatus) => void): () => void
  subscribeActivity(listener: (entry: RemoteBridgeActivityEntry) => void): () => void
  waitForReady(timeoutMs: number): Promise<boolean>
}

export interface PlayFrontendTarget {
  generation: number
  kind: "packaged" | "remote"
  gameCardId: string
  entry?: string
  mount: ReadonlyMountedRemoteIframeFrontend
}

export interface RegisterPlayFrontendTargetInput {
  kind: PlayFrontendTarget["kind"]
  gameCardId: string
  entry?: string
  mount: MountedRemoteIframeFrontend
}

type PlayFrontendTargetListener = (target: PlayFrontendTarget | null) => void

let generation = 0
let currentTarget: PlayFrontendTarget | null = null
const listeners = new Set<PlayFrontendTargetListener>()

function notify(): void {
  for (const listener of listeners) {
    listener(currentTarget)
  }
}

function createReadonlyMount(
  mount: MountedRemoteIframeFrontend,
): ReadonlyMountedRemoteIframeFrontend {
  return {
    iframe: mount.iframe,
    sessionId: mount.sessionId,
    get status() {
      return mount.status
    },
    get activitySequence() {
      return mount.activitySequence
    },
    get inFlightRequestCount() {
      return mount.inFlightRequestCount
    },
    get lastActivityAt() {
      return mount.lastActivityAt
    },
    subscribeStatus: (listener) => mount.subscribeStatus(listener),
    subscribeActivity: (listener) => mount.subscribeActivity(listener),
    waitForReady: (timeoutMs) => mount.waitForReady(timeoutMs),
  }
}

export function registerPlayFrontendTarget(
  input: RegisterPlayFrontendTargetInput,
): () => void {
  const target: PlayFrontendTarget = {
    generation: ++generation,
    kind: input.kind,
    gameCardId: input.gameCardId,
    ...(input.entry ? { entry: input.entry } : {}),
    mount: createReadonlyMount(input.mount),
  }
  currentTarget = target
  const unsubscribeStatus = input.mount.subscribeStatus(() => {
    if (currentTarget === target) {
      notify()
    }
  })
  notify()

  return () => {
    unsubscribeStatus()
    if (currentTarget !== target) {
      return
    }
    currentTarget = null
    notify()
  }
}

export function getPlayFrontendTarget(): PlayFrontendTarget | null {
  return currentTarget
}

export function subscribePlayFrontendTarget(
  listener: PlayFrontendTargetListener,
): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function waitForNextReadyPlayFrontendTarget(
  afterGeneration: number,
  timeoutMs: number,
): Promise<PlayFrontendTarget | null> {
  const current = getPlayFrontendTarget()
  if (current && current.generation > afterGeneration && current.mount.status === "ready") {
    return Promise.resolve(current)
  }

  return new Promise((resolve) => {
    let settled = false
    let timer = 0
    const finish = (target: PlayFrontendTarget | null) => {
      if (settled) {
        return
      }
      settled = true
      window.clearTimeout(timer)
      unsubscribe()
      resolve(target)
    }
    const unsubscribe = subscribePlayFrontendTarget((target) => {
      if (target && target.generation > afterGeneration && target.mount.status === "ready") {
        finish(target)
      }
    })
    timer = window.setTimeout(() => finish(null), Math.max(0, timeoutMs))
  })
}
