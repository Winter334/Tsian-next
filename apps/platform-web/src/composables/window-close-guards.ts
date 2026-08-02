export type WindowBeforeCloseHandler = () => Promise<boolean>

const beforeCloseHandlers = new Map<string, WindowBeforeCloseHandler>()

export function setBeforeClose(id: string, handler: WindowBeforeCloseHandler): void {
  beforeCloseHandlers.set(id, handler)
}

export function clearBeforeClose(id: string): void {
  beforeCloseHandlers.delete(id)
}

/** Runs the guard without mutating shell state. Callers mutate only after true. */
export async function canCloseWindow(id: string): Promise<boolean> {
  return (await beforeCloseHandlers.get(id)?.()) ?? true
}

export function forgetWindowCloseGuard(id: string): void {
  beforeCloseHandlers.delete(id)
}
