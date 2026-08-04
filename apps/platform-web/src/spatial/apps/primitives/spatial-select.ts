export interface SpatialSelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SpatialSelectInteractionState {
  open: boolean
  activeIndex: number
}

export interface SpatialSelectKeyResult extends SpatialSelectInteractionState {
  handled: boolean
  selectedValue?: string
}

export function shouldCloseSpatialSelectFromPointerDown(
  root: Node | null,
  event: Pick<PointerEvent, "isTrusted" | "target">,
): boolean {
  if (!root || event.isTrusted || !(event.target instanceof Node)) return false
  return !root.contains(event.target)
}

export function spatialSelectSelectedIndex(
  options: readonly SpatialSelectOption[],
  selectedValue: string,
): number {
  const index = options.findIndex((option) => option.value === selectedValue && !option.disabled)
  return index >= 0 ? index : firstEnabledIndex(options)
}

export function spatialSelectKeyResult(
  options: readonly SpatialSelectOption[],
  selectedValue: string,
  state: SpatialSelectInteractionState,
  key: string,
): SpatialSelectKeyResult {
  const selectedIndex = spatialSelectSelectedIndex(options, selectedValue)
  const activeIndex = enabledIndexOrFallback(options, state.activeIndex, selectedIndex)
  const hasOptions = activeIndex >= 0

  if (!state.open) {
    if (key === "Enter" || key === " " || key === "Spacebar" || key === "ArrowDown" || key === "ArrowUp") {
      return { handled: true, open: hasOptions, activeIndex }
    }
    if (key === "Home" || key === "End") {
      const edgeIndex = key === "Home" ? firstEnabledIndex(options) : lastEnabledIndex(options)
      return { handled: true, open: edgeIndex >= 0, activeIndex: edgeIndex }
    }
    return { handled: false, open: false, activeIndex }
  }

  if (key === "Escape") return { handled: true, open: false, activeIndex }
  if (key === "Tab") return { handled: false, open: false, activeIndex }
  if (key === "Home") return { handled: true, open: true, activeIndex: firstEnabledIndex(options) }
  if (key === "End") return { handled: true, open: true, activeIndex: lastEnabledIndex(options) }
  if (key === "ArrowDown" || key === "ArrowUp") {
    return {
      handled: true,
      open: true,
      activeIndex: adjacentEnabledIndex(options, activeIndex, key === "ArrowDown" ? 1 : -1),
    }
  }
  if (key === "Enter" || key === " " || key === "Spacebar") {
    const option = options[activeIndex]
    return option && !option.disabled
      ? { handled: true, open: false, activeIndex, selectedValue: option.value }
      : { handled: true, open: true, activeIndex }
  }
  return { handled: false, open: true, activeIndex }
}

function enabledIndexOrFallback(
  options: readonly SpatialSelectOption[],
  candidate: number,
  fallback: number,
): number {
  return options[candidate] && !options[candidate].disabled ? candidate : fallback
}

function firstEnabledIndex(options: readonly SpatialSelectOption[]): number {
  return options.findIndex((option) => !option.disabled)
}

function lastEnabledIndex(options: readonly SpatialSelectOption[]): number {
  for (let index = options.length - 1; index >= 0; index -= 1) {
    if (!options[index]?.disabled) return index
  }
  return -1
}

function adjacentEnabledIndex(
  options: readonly SpatialSelectOption[],
  currentIndex: number,
  direction: 1 | -1,
): number {
  for (let index = currentIndex + direction; index >= 0 && index < options.length; index += direction) {
    if (!options[index]?.disabled) return index
  }
  return currentIndex
}
