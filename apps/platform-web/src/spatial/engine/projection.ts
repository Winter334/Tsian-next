import type { ClientRectLike } from "./input/coordinates"
import {
  DEFAULT_SURFACE_POSE,
  PHYSICAL_SURFACE_EPSILON,
  projectPhysicalSurfacePoint,
  surfaceFocalLength,
  validSurfacePose,
  validSurfaceRect,
  type SpatialPoint,
  type SpatialPoint3,
  type SpatialSurfacePose,
} from "./physical-surface"

export {
  DEFAULT_SURFACE_POSE,
  SURFACE_FOCAL_LENGTH_FACTOR,
  projectPhysicalSurfaceBounds,
} from "./physical-surface"
export type {
  ProjectedSurfaceBounds,
  SpatialPoint,
  SpatialPoint3,
  SpatialSurfacePose,
  SurfaceLocalBounds,
} from "./physical-surface"

export interface SpatialSurfaceProjection {
  readonly sourceRect: ClientRectLike
  readonly viewportRect: ClientRectLike
  readonly pose: SpatialSurfacePose
  /** NDC offset shared with the surface vertex shader. */
  readonly parallax?: SpatialPoint
}

export interface ProjectedSurfacePoint {
  readonly localNormalized: SpatialPoint
  readonly localClient: SpatialPoint
  readonly localSurface: SpatialPoint3
  readonly cameraSpace: SpatialPoint3
  readonly visualClient: SpatialPoint
  readonly clipW: number
  readonly depth: number
}

export type SurfaceProjectionFailureReason =
  | "invalid-projection"
  | "outside-surface"
  | "non-convergent"

export type SurfaceProjectionResult =
  | ({ readonly ok: true } & ProjectedSurfacePoint)
  | {
      readonly ok: false
      readonly reason: SurfaceProjectionFailureReason
      readonly input: SpatialPoint
    }

export const SURFACE_PROJECTION_EPSILON = PHYSICAL_SURFACE_EPSILON
export const SURFACE_PROJECTION_TOLERANCE = 1e-7
export const SURFACE_MESH_COLUMNS = 96
export const SURFACE_MESH_ROWS = 48

const NEWTON_ITERATIONS = 18
const NEWTON_STEP = 1e-4
const MAX_CAPTURE_LOCAL_COORDINATE = 6

function localClientPoint(local: SpatialPoint, rect: ClientRectLike): SpatialPoint {
  return {
    x: rect.left + (local.x + 1) * rect.width / 2,
    y: rect.top + (local.y + 1) * rect.height / 2,
  }
}

function projectAnalyticVertex(
  local: SpatialPoint,
  projection: SpatialSurfaceProjection,
): ProjectedSurfacePoint | null {
  const { sourceRect, viewportRect, pose } = projection
  const projected = projectPhysicalSurfacePoint(local, projection)
  if (!projected) return null

  return {
    localNormalized: local,
    localClient: localClientPoint(local, sourceRect),
    localSurface: projected.localSurface,
    cameraSpace: projected.cameraSpace,
    visualClient: projected.visualClient,
    clipW: projected.clipW,
    depth: projected.cameraSpace.z,
  }
}

function interpolatePoint3(
  first: SpatialPoint3,
  firstWeight: number,
  second: SpatialPoint3,
  secondWeight: number,
  third: SpatialPoint3,
  thirdWeight: number,
): SpatialPoint3 {
  return {
    x: first.x * firstWeight + second.x * secondWeight + third.x * thirdWeight,
    y: first.y * firstWeight + second.y * secondWeight + third.y * thirdWeight,
    z: first.z * firstWeight + second.z * secondWeight + third.z * thirdWeight,
  }
}

function interpolateProjectedPoint(
  local: SpatialPoint,
  projection: SpatialSurfaceProjection,
  vertices: readonly [
    ProjectedSurfacePoint,
    number,
    ProjectedSurfacePoint,
    number,
    ProjectedSurfacePoint,
    number,
  ],
): ProjectedSurfacePoint {
  const [first, firstWeight, second, secondWeight, third, thirdWeight] = vertices
  const screenWeightTotal = firstWeight * first.clipW
    + secondWeight * second.clipW
    + thirdWeight * third.clipW
  const firstScreenWeight = firstWeight * first.clipW / screenWeightTotal
  const secondScreenWeight = secondWeight * second.clipW / screenWeightTotal
  const thirdScreenWeight = thirdWeight * third.clipW / screenWeightTotal
  const localSurface = interpolatePoint3(
    first.localSurface,
    firstWeight,
    second.localSurface,
    secondWeight,
    third.localSurface,
    thirdWeight,
  )
  const cameraSpace = interpolatePoint3(
    first.cameraSpace,
    firstWeight,
    second.cameraSpace,
    secondWeight,
    third.cameraSpace,
    thirdWeight,
  )
  const focal = surfaceFocalLength(projection.viewportRect)
  const clipW = (focal + cameraSpace.z) / focal
  return {
    localNormalized: local,
    localClient: localClientPoint(local, projection.sourceRect),
    localSurface,
    cameraSpace,
    visualClient: {
      x: first.visualClient.x * firstScreenWeight
        + second.visualClient.x * secondScreenWeight
        + third.visualClient.x * thirdScreenWeight,
      y: first.visualClient.y * firstScreenWeight
        + second.visualClient.y * secondScreenWeight
        + third.visualClient.y * thirdScreenWeight,
    },
    clipW,
    depth: cameraSpace.z,
  }
}

/** Matches the two GPU triangles generated for each ruled-patch grid cell. */
function projectUnchecked(
  local: SpatialPoint,
  projection: SpatialSurfaceProjection,
): ProjectedSurfacePoint | null {
  if (Math.abs(local.x) > 1 || Math.abs(local.y) > 1) {
    return projectAnalyticVertex(local, projection)
  }
  const columnPosition = (local.x + 1) * SURFACE_MESH_COLUMNS / 2
  const rowPosition = (local.y + 1) * SURFACE_MESH_ROWS / 2
  const column = Math.min(SURFACE_MESH_COLUMNS - 1, Math.floor(columnPosition))
  const row = Math.min(SURFACE_MESH_ROWS - 1, Math.floor(rowPosition))
  const horizontal = columnPosition - column
  const vertical = rowPosition - row
  const left = -1 + column * 2 / SURFACE_MESH_COLUMNS
  const right = -1 + (column + 1) * 2 / SURFACE_MESH_COLUMNS
  const top = -1 + row * 2 / SURFACE_MESH_ROWS
  const bottom = -1 + (row + 1) * 2 / SURFACE_MESH_ROWS
  const leftTop = projectAnalyticVertex({ x: left, y: top }, projection)
  const rightTop = projectAnalyticVertex({ x: right, y: top }, projection)
  const leftBottom = projectAnalyticVertex({ x: left, y: bottom }, projection)
  const rightBottom = projectAnalyticVertex({ x: right, y: bottom }, projection)
  if (!leftTop || !rightTop || !leftBottom || !rightBottom) return null

  if (horizontal + vertical <= 1) {
    return interpolateProjectedPoint(local, projection, [
      leftTop, 1 - horizontal - vertical,
      rightTop, horizontal,
      leftBottom, vertical,
    ])
  }
  return interpolateProjectedPoint(local, projection, [
    leftBottom, 1 - horizontal,
    rightTop, 1 - vertical,
    rightBottom, horizontal + vertical - 1,
  ])
}

function isInsideSurface(local: SpatialPoint): boolean {
  return Math.abs(local.x) <= 1 + SURFACE_PROJECTION_TOLERANCE
    && Math.abs(local.y) <= 1 + SURFACE_PROJECTION_TOLERANCE
}

function errorMagnitude(left: SpatialPoint, right: SpatialPoint): number {
  return Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y))
}

function triangleWeights(
  point: SpatialPoint,
  first: SpatialPoint,
  second: SpatialPoint,
  third: SpatialPoint,
): readonly [number, number, number] | null {
  const determinant = (second.y - third.y) * (first.x - third.x)
    + (third.x - second.x) * (first.y - third.y)
  if (!Number.isFinite(determinant) || Math.abs(determinant) <= SURFACE_PROJECTION_EPSILON) {
    return null
  }
  const firstWeight = ((second.y - third.y) * (point.x - third.x)
    + (third.x - second.x) * (point.y - third.y)) / determinant
  const secondWeight = ((third.y - first.y) * (point.x - third.x)
    + (first.x - third.x) * (point.y - third.y)) / determinant
  const thirdWeight = 1 - firstWeight - secondWeight
  const tolerance = SURFACE_PROJECTION_EPSILON * 8
  return firstWeight >= -tolerance && secondWeight >= -tolerance && thirdWeight >= -tolerance
    ? [firstWeight, secondWeight, thirdWeight]
    : null
}

function perspectiveCorrectLocalWeights(
  screenWeights: readonly [number, number, number],
  vertices: readonly [ProjectedSurfacePoint, ProjectedSurfacePoint, ProjectedSurfacePoint],
  viewportRect: ClientRectLike,
): readonly [number, number, number] | null {
  const weighted = screenWeights.map((weight, index) => {
    return weight / vertices[index].clipW
  })
  const total = weighted[0] + weighted[1] + weighted[2]
  if (!Number.isFinite(total) || Math.abs(total) <= SURFACE_PROJECTION_EPSILON) return null
  return [weighted[0] / total, weighted[1] / total, weighted[2] / total]
}

function unprojectVisibleMeshPoint(
  visualClient: SpatialPoint,
  projection: SpatialSurfaceProjection,
): ProjectedSurfacePoint | null {
  const grid: ProjectedSurfacePoint[][] = []
  for (let row = 0; row <= SURFACE_MESH_ROWS; row += 1) {
    const localY = -1 + row * 2 / SURFACE_MESH_ROWS
    const vertices: ProjectedSurfacePoint[] = []
    for (let column = 0; column <= SURFACE_MESH_COLUMNS; column += 1) {
      const localX = -1 + column * 2 / SURFACE_MESH_COLUMNS
      const vertex = projectAnalyticVertex({ x: localX, y: localY }, projection)
      if (!vertex) return null
      vertices.push(vertex)
    }
    grid.push(vertices)
  }

  for (let row = 0; row < SURFACE_MESH_ROWS; row += 1) {
    for (let column = 0; column < SURFACE_MESH_COLUMNS; column += 1) {
      const leftTop = grid[row][column]
      const rightTop = grid[row][column + 1]
      const leftBottom = grid[row + 1][column]
      const rightBottom = grid[row + 1][column + 1]

      const upperWeights = triangleWeights(
        visualClient,
        leftTop.visualClient,
        rightTop.visualClient,
        leftBottom.visualClient,
      )
      if (upperWeights) {
        const localWeights = perspectiveCorrectLocalWeights(
          upperWeights,
          [leftTop, rightTop, leftBottom],
          projection.viewportRect,
        )
        if (!localWeights) return null
        const [leftTopWeight, rightTopWeight, leftBottomWeight] = localWeights
        const local = {
          x: leftTop.localNormalized.x * leftTopWeight
            + rightTop.localNormalized.x * rightTopWeight
            + leftBottom.localNormalized.x * leftBottomWeight,
          y: leftTop.localNormalized.y * leftTopWeight
            + rightTop.localNormalized.y * rightTopWeight
            + leftBottom.localNormalized.y * leftBottomWeight,
        }
        return interpolateProjectedPoint(local, projection, [
          leftTop, leftTopWeight,
          rightTop, rightTopWeight,
          leftBottom, leftBottomWeight,
        ])
      }

      const lowerWeights = triangleWeights(
        visualClient,
        leftBottom.visualClient,
        rightTop.visualClient,
        rightBottom.visualClient,
      )
      if (lowerWeights) {
        const localWeights = perspectiveCorrectLocalWeights(
          lowerWeights,
          [leftBottom, rightTop, rightBottom],
          projection.viewportRect,
        )
        if (!localWeights) return null
        const [leftBottomWeight, rightTopWeight, rightBottomWeight] = localWeights
        const local = {
          x: leftBottom.localNormalized.x * leftBottomWeight
            + rightTop.localNormalized.x * rightTopWeight
            + rightBottom.localNormalized.x * rightBottomWeight,
          y: leftBottom.localNormalized.y * leftBottomWeight
            + rightTop.localNormalized.y * rightTopWeight
            + rightBottom.localNormalized.y * rightBottomWeight,
        }
        return interpolateProjectedPoint(local, projection, [
          leftBottom, leftBottomWeight,
          rightTop, rightTopWeight,
          rightBottom, rightBottomWeight,
        ])
      }
    }
  }
  return null
}

export function projectSurfacePoint(
  localNormalized: SpatialPoint,
  projection: SpatialSurfaceProjection,
  options: { readonly allowOutside?: boolean } = {},
): SurfaceProjectionResult {
  if (!validSurfaceRect(projection.sourceRect)
    || !validSurfaceRect(projection.viewportRect)
    || !validSurfacePose(projection.pose)) {
    return { ok: false, reason: "invalid-projection", input: localNormalized }
  }
  if (!options.allowOutside && !isInsideSurface(localNormalized)) {
    return { ok: false, reason: "outside-surface", input: localNormalized }
  }
  const projected = projectUnchecked(localNormalized, projection)
  return projected
    ? { ok: true, ...projected }
    : { ok: false, reason: "invalid-projection", input: localNormalized }
}

export function unprojectSurfacePoint(
  visualClient: SpatialPoint,
  projection: SpatialSurfaceProjection,
  options: { readonly allowOutside?: boolean } = {},
): SurfaceProjectionResult {
  if (!validSurfaceRect(projection.sourceRect)
    || !validSurfaceRect(projection.viewportRect)
    || !validSurfacePose(projection.pose)) {
    return { ok: false, reason: "invalid-projection", input: visualClient }
  }

  const visibleMapping = unprojectVisibleMeshPoint(visualClient, projection)
  if (visibleMapping) return { ok: true, ...visibleMapping }
  if (!options.allowOutside) {
    return { ok: false, reason: "outside-surface", input: visualClient }
  }

  const parallax = projection.parallax ?? { x: 0, y: 0 }
  const center = {
    x: projection.sourceRect.left + projection.sourceRect.width / 2
      + parallax.x * projection.viewportRect.width / 2,
    y: projection.sourceRect.top + projection.sourceRect.height / 2
      - parallax.y * projection.viewportRect.height / 2,
  }
  const focal = surfaceFocalLength(projection.viewportRect)
  const centerPerspective = focal / (focal + projection.pose.depth)
  let current = {
    x: (visualClient.x - center.x)
      / Math.max(SURFACE_PROJECTION_EPSILON, projection.sourceRect.width / 2 * projection.pose.scale * centerPerspective),
    y: (visualClient.y - center.y)
      / Math.max(SURFACE_PROJECTION_EPSILON, projection.sourceRect.height / 2 * projection.pose.scale * centerPerspective),
  }

  for (let iteration = 0; iteration < NEWTON_ITERATIONS; iteration += 1) {
    const mapped = projectAnalyticVertex(current, projection)
    if (!mapped) break
    const error = {
      x: mapped.visualClient.x - visualClient.x,
      y: mapped.visualClient.y - visualClient.y,
    }
    if (Math.max(Math.abs(error.x), Math.abs(error.y)) <= SURFACE_PROJECTION_TOLERANCE) {
      return { ok: true, ...mapped }
    }

    const xSample = projectAnalyticVertex({ x: current.x + NEWTON_STEP, y: current.y }, projection)
    const ySample = projectAnalyticVertex({ x: current.x, y: current.y + NEWTON_STEP }, projection)
    if (!xSample || !ySample) break
    const xx = (xSample.visualClient.x - mapped.visualClient.x) / NEWTON_STEP
    const yx = (xSample.visualClient.y - mapped.visualClient.y) / NEWTON_STEP
    const xy = (ySample.visualClient.x - mapped.visualClient.x) / NEWTON_STEP
    const yy = (ySample.visualClient.y - mapped.visualClient.y) / NEWTON_STEP
    const determinant = xx * yy - xy * yx
    if (!Number.isFinite(determinant) || Math.abs(determinant) <= SURFACE_PROJECTION_EPSILON) break
    const step = {
      x: (yy * error.x - xy * error.y) / determinant,
      y: (xx * error.y - yx * error.x) / determinant,
    }
    const previousError = errorMagnitude(mapped.visualClient, visualClient)
    let accepted = false
    let damping = 1
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const candidate = {
        x: Math.max(-MAX_CAPTURE_LOCAL_COORDINATE, Math.min(MAX_CAPTURE_LOCAL_COORDINATE, current.x - step.x * damping)),
        y: Math.max(-MAX_CAPTURE_LOCAL_COORDINATE, Math.min(MAX_CAPTURE_LOCAL_COORDINATE, current.y - step.y * damping)),
      }
      const candidateProjection = projectAnalyticVertex(candidate, projection)
      if (candidateProjection
        && errorMagnitude(candidateProjection.visualClient, visualClient) < previousError) {
        current = candidate
        accepted = true
        break
      }
      damping *= 0.5
    }
    if (!accepted) break
  }

  return { ok: false, reason: "non-convergent", input: visualClient }
}

export function surfacePoseShaderUniforms(
  pose: SpatialSurfacePose,
  viewportRect: ClientRectLike,
): {
  readonly depth: number
  readonly yaw: number
  readonly pitch: number
  readonly scale: number
  readonly curveHalfAngle: number
  readonly focalLength: number
} {
  if (!validSurfaceRect(viewportRect) || !validSurfacePose(pose)) {
    throw new Error("Invalid Spatial surface projection configuration.")
  }
  return { ...pose, focalLength: surfaceFocalLength(viewportRect) }
}
