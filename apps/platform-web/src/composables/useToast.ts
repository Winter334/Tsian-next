import { ref } from "vue"

export type ToastType = "info" | "success" | "error"

export interface ToastEntry {
  id: number
  message: string
  type: ToastType
}

export interface ToastOptions {
  type?: ToastType
  /** Milliseconds before auto-dismiss. Defaults to 3500; errors default to 6000. */
  duration?: number
}

/** Maximum toasts kept on screen; older ones are dropped when exceeded. */
const MAX_TOASTS = 4

const toasts = ref<ToastEntry[]>([])
let nextId = 1

function dismiss(id: number): void {
  const index = toasts.value.findIndex((entry) => entry.id === id)
  if (index >= 0) {
    toasts.value.splice(index, 1)
  }
}

function push(message: string, options: ToastOptions = {}): void {
  const type = options.type ?? "info"
  const duration = options.duration ?? (type === "error" ? 6000 : 3500)
  const entry: ToastEntry = { id: nextId++, message, type }
  toasts.value.push(entry)
  // Trim to the most recent MAX_TOASTS entries.
  if (toasts.value.length > MAX_TOASTS) {
    toasts.value.splice(0, toasts.value.length - MAX_TOASTS)
  }
  if (duration > 0) {
    const id = entry.id
    window.setTimeout(() => dismiss(id), duration)
  }
}

export interface ToastApi {
  (message: string, options?: ToastOptions): void
  info(message: string, options?: ToastOptions): void
  success(message: string, options?: ToastOptions): void
  error(message: string, options?: ToastOptions): void
  dismiss(id: number): void
}

export const toast: ToastApi = Object.assign(
  (message: string, options?: ToastOptions) => push(message, options),
  {
    info: (message: string, options?: ToastOptions) => push(message, { ...options, type: "info" }),
    success: (message: string, options?: ToastOptions) => push(message, { ...options, type: "success" }),
    error: (message: string, options?: ToastOptions) => push(message, { ...options, type: "error" }),
    dismiss,
  },
)

/** Read-only reactive view of the active toast queue (consumed by ToastHost). */
export function useToasts() {
  return toasts
}
