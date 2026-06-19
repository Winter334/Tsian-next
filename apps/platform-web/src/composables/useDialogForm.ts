import { ref } from "vue"

export type DialogFormFieldType = "text" | "password" | "number" | "select" | "textarea"

export interface DialogFormFieldOption {
  value: string
  label: string
}

export interface DialogFormField {
  name: string
  label: string
  type?: DialogFormFieldType
  placeholder?: string
  defaultValue?: string
  options?: DialogFormFieldOption[]
  /** Monospace font for code-like values (urls, keys, model ids). */
  mono?: boolean
  rows?: number
}

export interface DialogFormTestResult {
  ok: boolean
  message: string
}

export interface DialogFormOptions {
  title: string
  /** Field definitions for the built-in form. Leave empty and use the slot for custom content. */
  fields?: DialogFormField[]
  confirmText?: string
  cancelText?: string
  /** Width tailwind class for the panel, e.g. "max-w-md". Defaults to "max-w-sm". */
  widthClass?: string
  /** Label for the optional connectivity-test button. When set, the button renders. */
  testLabel?: string
  /**
   * Optional async connectivity test run when the user clicks the test button.
   * Receives the current form values (field-based). Returns ok + message to show inline.
   */
  test?: (values: Record<string, string>) => Promise<DialogFormTestResult>
  /**
   * Validate before confirm. Receives the form values (field-based) or a getter
   * supplied via the slot. Return an error message string to block close, or null.
   */
  validate?: (values: Record<string, string>) => string | null
}

interface PendingDialog {
  options: Required<Omit<DialogFormOptions, "fields" | "validate" | "test" | "testLabel">> & {
    fields: DialogFormField[]
    validate: (values: Record<string, string>) => string | null
    testLabel: string
    test: ((values: Record<string, string>) => Promise<DialogFormTestResult>) | null
  }
  resolve: (value: Record<string, string> | null) => void
}

const pending = ref<PendingDialog | null>(null)

/**
 * The live form values, written by DialogForm as the user edits. The dialog
 * resolves with a snapshot of these on confirm.
 */
const formValues = ref<Record<string, string>>({})

function resolveCurrent(values: Record<string, string> | null): void {
  const current = pending.value
  if (!current) {
    return
  }
  pending.value = null
  current.resolve(values)
}

/**
 * Open a form dialog. Resolves with the field values on confirm, or `null` on
 * cancel. Only one dialog is allowed at a time; a second open while one is
 * active auto-rejects with null.
 */
export function openDialogForm(options: DialogFormOptions): Promise<Record<string, string> | null> {
  if (pending.value) {
    return Promise.resolve(null)
  }
  return new Promise<Record<string, string> | null>((resolve) => {
    pending.value = {
      options: {
        title: options.title,
        fields: options.fields ?? [],
        confirmText: options.confirmText ?? "确认",
        cancelText: options.cancelText ?? "取消",
        widthClass: options.widthClass ?? "max-w-sm",
        validate: options.validate ?? (() => null),
        testLabel: options.testLabel ?? "",
        test: options.test ?? null,
      },
      resolve,
    }
  })
}

/** Read-only reactive handle to the active dialog (consumed by DialogForm). */
export function useDialogFormState() {
  return pending
}

/** Reactive form values (DialogForm writes here; callers read after resolve). */
export function useDialogFormValues() {
  return formValues
}

/** Resolve the active dialog. Exposed for DialogForm; not for view code. */
export function resolveDialogForm(confirm: boolean): void {
  if (!confirm) {
    resolveCurrent(null)
    return
  }
  // Snapshot the current values so a later open does not mutate the resolved payload.
  resolveCurrent({ ...formValues.value })
}

/** Update a single field value (called by DialogForm inputs). */
export function setDialogFormValue(name: string, value: string): void {
  formValues.value = { ...formValues.value, [name]: value }
}

/** Reset form values (called by DialogForm when a new dialog opens). */
export function resetDialogFormValues(seed: Record<string, string>): void {
  formValues.value = { ...seed }
}
