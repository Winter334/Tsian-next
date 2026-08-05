import {
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
  type Ref,
} from "vue"
import {
  spatialShellMenuAnchorFromElement,
  spatialShellMenuAnchorFromSourceClient,
  spatialShellMenuLayout,
  type SpatialShellMenuLayout,
  type SpatialShellMenuViewport,
} from "./spatial-shell-context-menu"

export interface SpatialOwnedShellMenuState<T> {
  readonly target: T
  readonly layout: SpatialShellMenuLayout
}

export class SpatialShellMenuOutsidePointerGate {
  private sequence = 0
  private projectedInsideSequence = -1

  beginTrustedPointer(): number {
    this.sequence += 1
    this.projectedInsideSequence = -1
    return this.sequence
  }

  recordSyntheticPointer(insideOwnedSurface: boolean): "keep" | "close" {
    if (!insideOwnedSurface) return "close"
    this.projectedInsideSequence = this.sequence
    return "keep"
  }

  shouldCloseAfterProjection(sequence: number): boolean {
    return sequence === this.sequence && this.projectedInsideSequence !== sequence
  }

  reset(): void {
    this.sequence += 1
    this.projectedInsideSequence = -1
  }
}

export function useSpatialShellContextMenu<T>(options: {
  readonly ownerSourceId: string
  readonly menuSourceId: string
  readonly viewport: () => SpatialShellMenuViewport
  readonly itemCount: (target: T) => number
  readonly sourceTopologyChanged: () => void
  readonly sourceDirty: (sourceId: string) => void
}): {
  readonly sourceRef: Ref<HTMLElement | null>
  readonly menu: Ref<SpatialOwnedShellMenuState<T> | null>
  readonly openPointerMenu: (target: T, event: MouseEvent) => void
  readonly openKeyboardMenu: (target: T, event: KeyboardEvent) => void
  readonly closeMenu: (restoreFocus: boolean) => void
} {
  const sourceRef = ref<HTMLElement | null>(null)
  const menu = shallowRef<SpatialOwnedShellMenuState<T> | null>(null)
  const outsidePointerGate = new SpatialShellMenuOutsidePointerGate()
  let opener: HTMLElement | null = null

  function openMenu(target: T, anchor: { readonly x: number; readonly y: number }): void {
    const topologyChanged = !menu.value
    menu.value = {
      target,
      layout: spatialShellMenuLayout(options.viewport(), anchor, options.itemCount(target)),
    }
    void nextTick(() => {
      if (topologyChanged) options.sourceTopologyChanged()
      else options.sourceDirty(options.menuSourceId)
    })
  }

  function openPointerMenu(target: T, event: MouseEvent): void {
    const source = sourceRef.value
    if (!source) return
    opener = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("button") : null
    openMenu(target, spatialShellMenuAnchorFromSourceClient(
      source.getBoundingClientRect(),
      { x: event.clientX, y: event.clientY },
    ))
  }

  function openKeyboardMenu(target: T, event: KeyboardEvent): void {
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return
    event.preventDefault()
    event.stopPropagation()
    const currentTarget = event.currentTarget
    if (!(currentTarget instanceof HTMLElement)) return
    opener = currentTarget
    openMenu(target, spatialShellMenuAnchorFromElement(currentTarget.getBoundingClientRect()))
  }

  function closeMenu(restoreFocus: boolean): void {
    if (!menu.value) return
    const restoreTarget = opener
    menu.value = null
    opener = null
    outsidePointerGate.reset()
    void nextTick(() => {
      options.sourceTopologyChanged()
      if (restoreFocus && restoreTarget?.isConnected) {
        restoreTarget.focus()
        options.sourceDirty(options.ownerSourceId)
      }
    })
  }

  function eventInsideMenuSurface(event: Event): boolean {
    const target = event.target
    if (!(target instanceof Element)) return false
    return target.closest(`[data-spatial-source="${options.menuSourceId}"]`) !== null
  }

  function handleDocumentPointerDown(event: PointerEvent): void {
    if (!menu.value) return
    if (event.isTrusted) {
      const sequence = outsidePointerGate.beginTrustedPointer()
      queueMicrotask(() => {
        if (menu.value && outsidePointerGate.shouldCloseAfterProjection(sequence)) {
          closeMenu(false)
        }
      })
      return
    }
    if (outsidePointerGate.recordSyntheticPointer(eventInsideMenuSurface(event)) === "close") {
      closeMenu(false)
    }
  }

  function handleDocumentFocusIn(event: FocusEvent): void {
    if (!menu.value || eventInsideMenuSurface(event)) return
    closeMenu(false)
  }

  onMounted(() => {
    document.addEventListener("pointerdown", handleDocumentPointerDown, true)
    document.addEventListener("focusin", handleDocumentFocusIn, true)
  })

  watch(
    () => [options.viewport().width, options.viewport().height],
    () => closeMenu(false),
  )

  onBeforeUnmount(() => {
    document.removeEventListener("pointerdown", handleDocumentPointerDown, true)
    document.removeEventListener("focusin", handleDocumentFocusIn, true)
  })

  return { sourceRef, menu, openPointerMenu, openKeyboardMenu, closeMenu }
}
