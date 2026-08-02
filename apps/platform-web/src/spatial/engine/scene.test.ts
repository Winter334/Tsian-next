import { describe, expect, it } from "vitest"
import { DEFAULT_SURFACE_POSE, projectSurfacePoint } from "./projection"
import {
  captureSceneProjection,
  projectCapturedSceneSource,
  projectedSceneHits,
  sceneSourceForElement,
  sortSceneSourcesBackToFront,
  sourceTextureUv,
  type SceneSourceSurface,
} from "./scene"
import { SOURCE_FRAGMENT_SHADER } from "./shaders/scene"

const viewportRect = { left: 0, top: 0, width: 1200, height: 800 }
const pose = { depth: 0, yaw: 0, pitch: 0, scale: 1, curveHalfAngle: 7 * Math.PI / 180 }

function source(
  sourceId: string,
  zIndex: number,
  rect = { left: 200, top: 120, width: 600, height: 460 },
): SceneSourceSurface {
  return {
    sourceId,
    zIndex,
    rect,
    parallaxFactor: 1,
    pose,
    root: {} as Element,
    window: true,
    active: false,
  }
}

describe("spatial scene geometry", () => {
  it("resolves a window before overlapping lower-z shell Docks", () => {
    const launcherDock = source("shell:launcher", 10)
    const statusDock = source("shell:status", 11)
    const front = source("window:front", 101, { left: 320, top: 180, width: 600, height: 460 })
    const overlap = projectSurfacePoint({ x: 0, y: 0 }, {
      sourceRect: front.rect,
      viewportRect,
      pose: front.pose,
    })
    expect(overlap.ok).toBe(true)
    if (!overlap.ok) return
    expect(projectedSceneHits([launcherDock, front, statusDock], overlap.visualClient, viewportRect)
      .map((hit) => hit.source.sourceId)).toEqual([
        "window:front",
        "shell:status",
        "shell:launcher",
      ])
  })

  it("sorts equal-depth surfaces deterministically", () => {
    expect(sortSceneSourcesBackToFront([
      source("window:zeta", 10),
      source("window:alpha", 10),
      source("window:rear", 2),
    ]).map((item) => item.sourceId)).toEqual([
      "window:rear",
      "window:alpha",
      "window:zeta",
    ])
  })

  it("keeps one Source projection independent when a sibling moves", () => {
    const stable = source("window:stable", 10)
    const movedBefore = source("window:moved", 20)
    const stableBefore = projectSurfacePoint({ x: 0.7, y: -1 }, {
      sourceRect: stable.rect,
      viewportRect,
      pose: stable.pose,
    })
    const movedAfter = { ...movedBefore, rect: { ...movedBefore.rect, left: 720 } }
    const stableAfter = projectSurfacePoint({ x: 0.7, y: -1 }, {
      sourceRect: stable.rect,
      viewportRect,
      pose: stable.pose,
    })
    expect(movedAfter.rect.left).not.toBe(movedBefore.rect.left)
    expect(stableAfter).toEqual(stableBefore)
  })

  it("keeps focused-window emphasis separate from transient routed active state", () => {
    const attributes = new Map<string, string>([
      ["data-spatial-source", "window:settings"],
      ["data-spatial-active", ""],
    ])
    const root = {
      getAttribute: (name: string) => attributes.get(name) ?? null,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }),
    } as unknown as Element
    expect(sceneSourceForElement(root).active).toBe(false)
    attributes.set("data-spatial-window-active", "true")
    expect(sceneSourceForElement(root).active).toBe(true)
  })

  it("uses the default pose when a Source omits optional pose metadata", () => {
    const root = {
      getAttribute: (name: string) => name === "data-spatial-source" ? "shell:clock" : null,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 160 }),
    } as unknown as Element

    const sceneSource = sceneSourceForElement(root)
    expect(sceneSource.pose).toEqual(DEFAULT_SURFACE_POSE)
    expect(sceneSource.parallaxFactor).toBe(1)
  })

  it("reads a generic per-Source parallax factor", () => {
    const root = {
      getAttribute: (name: string) => name === "data-spatial-parallax-factor" ? "0" : null,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 160 }),
    } as unknown as Element

    expect(sceneSourceForElement(root).parallaxFactor).toBe(0)
  })

  it("retains the pointer-down projection while a captured window moves and re-poses", () => {
    const initial = source("window:dragged", 10)
    const local = { x: 0.72, y: -0.64 }
    const projected = projectSurfacePoint(local, {
      sourceRect: initial.rect,
      viewportRect,
      pose: initial.pose,
      parallax: { x: 0.01, y: -0.02 },
    })
    expect(projected.ok).toBe(true)
    if (!projected.ok) return

    const captured = captureSceneProjection(
      initial,
      viewportRect,
      { x: 0.01, y: -0.02 },
    )
    const moved = source("window:dragged", 40, {
      left: 520,
      top: 260,
      width: 680,
      height: 500,
    })
    const liveProjection = captureSceneProjection({
      ...moved,
      pose: { ...moved.pose, yaw: 0.14, pitch: -0.08, depth: 72 },
    }, viewportRect, { x: -0.02, y: 0.015 })

    const retained = projectCapturedSceneSource(captured, projected.visualClient)
    const recomputed = projectCapturedSceneSource(liveProjection, projected.visualClient)
    expect(retained.ok).toBe(true)
    if (!retained.ok) return
    expect(retained.localNormalized.x).toBeCloseTo(local.x, 5)
    expect(retained.localNormalized.y).toBeCloseTo(local.y, 5)
    expect(recomputed.ok && Math.abs(recomputed.localNormalized.x - local.x) > 0.1).toBe(true)
  })

  it("maps mesh top/bottom and left/right directly to the top-left DOM upload convention", () => {
    expect(sourceTextureUv({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 })
    expect(sourceTextureUv({ x: 1, y: 1 })).toEqual({ x: 1, y: 1 })
    expect(sourceTextureUv({ x: 0.25, y: 0.75 })).toEqual({ x: 0.25, y: 0.75 })
    expect(SOURCE_FRAGMENT_SHADER).toContain("vec2 sourceUv = v_uv")
    expect(SOURCE_FRAGMENT_SHADER).not.toContain("1.0 - v_uv.y")
  })
})
