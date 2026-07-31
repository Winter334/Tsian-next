export interface SpatialPoint {
  readonly x: number
  readonly y: number
}

export interface CurveProjectionConfig {
  readonly maxAngleRadians: number
  readonly minCenterScale: number
}

export type ProjectionFailureReason = "outside-domain" | "invalid-config"

export type ProjectionResult =
  | {
      readonly ok: true
      readonly point: SpatialPoint
      readonly depth: number
    }
  | {
      readonly ok: false
      readonly reason: ProjectionFailureReason
      readonly input: SpatialPoint
    }

export const PROJECTION_EPSILON = 1e-7
export const PROJECTION_ROUND_TRIP_TOLERANCE = 1e-6

export const DEFAULT_CURVE_PROJECTION = Object.freeze<CurveProjectionConfig>({
  maxAngleRadians: Math.PI * 0.19,
  minCenterScale: 0.82,
})

function isValidConfig(config: CurveProjectionConfig): boolean {
  return Number.isFinite(config.maxAngleRadians)
    && config.maxAngleRadians > PROJECTION_EPSILON
    && config.maxAngleRadians < Math.PI / 2
    && Number.isFinite(config.minCenterScale)
    && config.minCenterScale > 0
    && config.minCenterScale <= 1
}

function isNormalized(value: number): boolean {
  return Number.isFinite(value)
    && value >= -1 - PROJECTION_EPSILON
    && value <= 1 + PROJECTION_EPSILON
}

function clampNormalized(value: number): number {
  return Math.max(-1, Math.min(1, value))
}

function verticalScale(theta: number, config: CurveProjectionConfig): number {
  return config.minCenterScale
    + (1 - config.minCenterScale) * curveDepth(theta, config)
}

function curveDepth(theta: number, config: CurveProjectionConfig): number {
  return (1 - Math.cos(theta)) / (1 - Math.cos(config.maxAngleRadians))
}

export function projectCylindrical(
  input: SpatialPoint,
  config: CurveProjectionConfig = DEFAULT_CURVE_PROJECTION,
): ProjectionResult {
  if (!isValidConfig(config)) {
    return { ok: false, reason: "invalid-config", input }
  }
  if (!isNormalized(input.x) || !isNormalized(input.y)) {
    return { ok: false, reason: "outside-domain", input }
  }

  const planarX = clampNormalized(input.x)
  const planarY = clampNormalized(input.y)
  const theta = planarX * config.maxAngleRadians
  return {
    ok: true,
    point: {
      x: Math.tan(theta) / Math.tan(config.maxAngleRadians),
      y: planarY * verticalScale(theta, config),
    },
    depth: curveDepth(theta, config),
  }
}

export function unprojectCylindrical(
  input: SpatialPoint,
  config: CurveProjectionConfig = DEFAULT_CURVE_PROJECTION,
): ProjectionResult {
  if (!isValidConfig(config)) {
    return { ok: false, reason: "invalid-config", input }
  }
  if (!isNormalized(input.x) || !isNormalized(input.y)) {
    return { ok: false, reason: "outside-domain", input }
  }

  const tangent = clampNormalized(input.x) * Math.tan(config.maxAngleRadians)
  const theta = Math.atan(tangent)
  const planar = {
    x: theta / config.maxAngleRadians,
    y: input.y / verticalScale(theta, config),
  }
  if (!isNormalized(planar.x) || !isNormalized(planar.y)) {
    return { ok: false, reason: "outside-domain", input }
  }

  return {
    ok: true,
    point: {
      x: clampNormalized(planar.x),
      y: clampNormalized(planar.y),
    },
    depth: curveDepth(theta, config),
  }
}

export function curveShaderUniforms(config: CurveProjectionConfig): {
  readonly maxAngleRadians: number
  readonly minCenterScale: number
} {
  if (!isValidConfig(config)) {
    throw new Error("Invalid curve projection configuration.")
  }
  return {
    maxAngleRadians: config.maxAngleRadians,
    minCenterScale: config.minCenterScale,
  }
}
