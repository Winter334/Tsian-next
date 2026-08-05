export interface SpatialSourceMutationRecord {
  readonly type: "attributes" | "characterData" | "childList"
  readonly target: Node
  readonly addedNodes?: Iterable<Node>
  readonly removedNodes?: Iterable<Node>
  readonly attributeName?: string | null
}

export interface SpatialSourceMutationPlan {
  readonly synchronize: boolean
  readonly dirtySourceIds: readonly string[]
}

const DYNAMIC_MEDIA_SELECTOR = "[data-spatial-dynamic-media]"

/**
 * Direct Source topology and dynamic-media discovery require a full registry
 * synchronization. Ordinary mutations inside an existing Source only need a
 * new texture generation for that Source.
 */
export function planSpatialSourceMutations(
  canvas: Element,
  records: readonly SpatialSourceMutationRecord[],
): SpatialSourceMutationPlan {
  const dirtySourceIds = new Set<string>()
  let synchronize = false

  for (const record of records) {
    const targetElement = elementForMutationTarget(record.target)
    const source = targetElement ? directSourceRoot(canvas, targetElement) : null
    const sourceId = source?.getAttribute("data-spatial-source")
    if (sourceId) dirtySourceIds.add(sourceId)

    if (record.type === "childList") {
      if (record.target === canvas
        || nodesContainDynamicMedia(record.addedNodes)
        || nodesContainDynamicMedia(record.removedNodes)) {
        synchronize = true
      }
      continue
    }

    if (record.type === "attributes" && targetElement) {
      if (targetElement.parentElement === canvas
        && targetElement.hasAttribute("data-spatial-source")) {
        synchronize = true
      }
      if (record.attributeName === "data-spatial-dynamic-media") synchronize = true
    }
  }

  return { synchronize, dirtySourceIds: [...dirtySourceIds] }
}

function elementForMutationTarget(target: Node): Element | null {
  if (target instanceof Element) return target
  return target.parentElement
}

function directSourceRoot(canvas: Element, element: Element): Element | null {
  const source = element.closest("[data-spatial-source]")
  return source?.parentElement === canvas ? source : null
}

function nodesContainDynamicMedia(nodes: Iterable<Node> | undefined): boolean {
  if (!nodes) return false
  for (const node of nodes) {
    if (!(node instanceof Element)) continue
    if (node.matches(DYNAMIC_MEDIA_SELECTOR) || node.querySelector(DYNAMIC_MEDIA_SELECTOR)) {
      return true
    }
  }
  return false
}
