import { ref } from "vue"

export type ConfirmSeverity = "normal" | "danger"

export interface ConfirmOptions {
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  severity?: ConfirmSeverity
}

export interface PromptOptions {
  title?: string
  message?: string
  defaultValue?: string
  placeholder?: string
  confirmText?: string
  cancelText?: string
  /** Returns an error message string to block submission, or null to accept. */
  validate?: (value: string) => string | null
}

type PendingRequest =
  | {
      kind: "confirm"
      options: Required<Omit<ConfirmOptions, "title">> & { title: string }
      resolve: (value: boolean) => void
    }
  | {
      kind: "prompt"
      options: Required<Omit<PromptOptions, "title" | "message" | "placeholder" | "validate">> & {
        title: string
        message: string
        placeholder: string
        validate: (value: string) => string | null
      }
      resolve: (value: string | null) => void
    }

const pending = ref<PendingRequest | null>(null)

function resolveCurrent(value: boolean | string | null): void {
  const current = pending.value
  if (!current) {
    return
  }
  pending.value = null
  if (current.kind === "confirm") {
    current.resolve(Boolean(value))
  } else {
    current.resolve(typeof value === "string" ? value : null)
  }
}

/** Show a confirmation dialog. Resolves `true` on confirm, `false` on cancel. */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  if (pending.value) {
    // A dialog is already open; auto-reject the new one rather than queuing.
    return Promise.resolve(false)
  }
  return new Promise<boolean>((resolve) => {
    pending.value = {
      kind: "confirm",
      options: {
        title: options.title ?? "确认操作",
        message: options.message,
        confirmText: options.confirmText ?? "确认",
        cancelText: options.cancelText ?? "取消",
        severity: options.severity ?? "normal",
      },
      resolve,
    }
  })
}

/** Show a prompt dialog with a single text input. Resolves the entered string, or null on cancel. */
export function prompt(options: PromptOptions): Promise<string | null> {
  if (pending.value) {
    return Promise.resolve(null)
  }
  return new Promise<string | null>((resolve) => {
    pending.value = {
      kind: "prompt",
      options: {
        title: options.title ?? "请输入",
        message: options.message ?? "",
        defaultValue: options.defaultValue ?? "",
        placeholder: options.placeholder ?? "",
        confirmText: options.confirmText ?? "确认",
        cancelText: options.cancelText ?? "取消",
        validate: options.validate ?? (() => null),
      },
      resolve,
    }
  })
}

/** Read-only reactive handle to the active dialog (consumed by ConfirmHost). */
export function useConfirmState() {
  return pending
}

/** Resolve the active dialog. Exposed for ConfirmHost; not for view code. */
export function resolveConfirm(value: boolean | string | null): void {
  resolveCurrent(value)
}
