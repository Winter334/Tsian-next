import { ref } from "vue"

export type ConfirmSeverity = "normal" | "danger"

export interface ConfirmOptions {
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  severity?: ConfirmSeverity
}

type PendingConfirm = {
  title: string
  message: string
  confirmText: string
  cancelText: string
  severity: ConfirmSeverity
  resolve: (value: boolean) => void
}

const pending = ref<PendingConfirm | null>(null)

export function confirm(options: ConfirmOptions): Promise<boolean> {
  if (pending.value) {
    return Promise.resolve(false)
  }

  return new Promise<boolean>((resolve) => {
    pending.value = {
      title: options.title ?? "确认操作",
      message: options.message,
      confirmText: options.confirmText ?? "确认",
      cancelText: options.cancelText ?? "取消",
      severity: options.severity ?? "normal",
      resolve,
    }
  })
}

export function useConfirmState() {
  return pending
}

export function resolveConfirm(value: boolean): void {
  const current = pending.value
  if (!current) return
  pending.value = null
  current.resolve(value)
}
