import type { RuntimeWorkspaceMutationEvent } from "@tsian/contracts"

type RuntimeWorkspaceMutationListener = (
  event: RuntimeWorkspaceMutationEvent,
) => void

const listeners = new Set<RuntimeWorkspaceMutationListener>()

export function subscribeRuntimeWorkspaceMutation(
  listener: RuntimeWorkspaceMutationListener,
): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function emitRuntimeWorkspaceMutation(
  event: RuntimeWorkspaceMutationEvent,
): void {
  for (const listener of listeners) {
    try {
      listener(event)
    } catch {
      // A local subscriber cannot change an already durable commit result.
    }
  }
}
