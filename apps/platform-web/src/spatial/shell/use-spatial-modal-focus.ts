import { nextTick, type Ref } from "vue"

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ")

export function useSpatialModalFocus(panel: Ref<HTMLElement | null>) {
  let returnTarget: HTMLElement | null = null

  function captureInvoker(): void {
    returnTarget = document.activeElement instanceof HTMLElement
      && document.activeElement !== document.body
      ? document.activeElement
      : null
  }

  function focusPanel(): void {
    panel.value?.focus()
  }

  function focusInitial(preferred?: HTMLElement | null, select = false): void {
    const target = preferred ?? focusableControls()[0] ?? panel.value
    target?.focus()
    if (select && target instanceof HTMLInputElement) target.select()
  }

  function trapTab(event: KeyboardEvent): void {
    const controls = focusableControls()
    const first = controls[0]
    const last = controls[controls.length - 1]
    if (!first || !last) {
      event.preventDefault()
      focusPanel()
      return
    }
    const active = document.activeElement
    if (event.shiftKey && (active === first || !panel.value?.contains(active))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (active === last || !panel.value?.contains(active))) {
      event.preventDefault()
      first.focus()
    }
  }

  function restoreInvoker(restore = true): void {
    const target = returnTarget
    returnTarget = null
    if (restore && target?.isConnected) void nextTick(() => target.focus())
  }

  function focusableControls(): HTMLElement[] {
    return [...(panel.value?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [])]
  }

  return { captureInvoker, focusInitial, focusPanel, restoreInvoker, trapTab }
}
