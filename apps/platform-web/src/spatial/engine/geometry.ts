import type { ClientRectLike } from "./input/coordinates"
import type { SpatialPoint } from "./projection"

export interface Vector3 {
  readonly x: number
  readonly y: number
  readonly z: number
}

export interface SpatialRay {
  readonly origin: Vector3
  readonly direction: Vector3
}

export interface SpatialQuad {
  readonly origin: Vector3
  readonly axisU: Vector3
  readonly axisV: Vector3
}

export type RayQuadIntersection =
  | {
      readonly hit: true
      readonly distance: number
      readonly point: Vector3
      readonly uv: SpatialPoint
    }
  | { readonly hit: false; readonly reason: "parallel" | "behind" | "outside" | "degenerate" }

function add(left: Vector3, right: Vector3): Vector3 {
  return { x: left.x + right.x, y: left.y + right.y, z: left.z + right.z }
}

function subtract(left: Vector3, right: Vector3): Vector3 {
  return { x: left.x - right.x, y: left.y - right.y, z: left.z - right.z }
}

function multiply(value: Vector3, scalar: number): Vector3 {
  return { x: value.x * scalar, y: value.y * scalar, z: value.z * scalar }
}

function dot(left: Vector3, right: Vector3): number {
  return left.x * right.x + left.y * right.y + left.z * right.z
}

function cross(left: Vector3, right: Vector3): Vector3 {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  }
}

export function intersectRayWithQuad(
  ray: SpatialRay,
  quad: SpatialQuad,
  epsilon = 1e-7,
): RayQuadIntersection {
  const normal = cross(quad.axisU, quad.axisV)
  const normalLengthSquared = dot(normal, normal)
  const uLengthSquared = dot(quad.axisU, quad.axisU)
  const vLengthSquared = dot(quad.axisV, quad.axisV)
  if (normalLengthSquared <= epsilon || uLengthSquared <= epsilon || vLengthSquared <= epsilon) {
    return { hit: false, reason: "degenerate" }
  }
  const denominator = dot(normal, ray.direction)
  if (Math.abs(denominator) <= epsilon) return { hit: false, reason: "parallel" }
  const distance = dot(normal, subtract(quad.origin, ray.origin)) / denominator
  if (distance < 0) return { hit: false, reason: "behind" }
  const point = add(ray.origin, multiply(ray.direction, distance))
  const local = subtract(point, quad.origin)
  const uDotV = dot(quad.axisU, quad.axisV)
  const localDotU = dot(local, quad.axisU)
  const localDotV = dot(local, quad.axisV)
  const determinant = uLengthSquared * vLengthSquared - uDotV * uDotV
  const uv = {
    x: (localDotU * vLengthSquared - localDotV * uDotV) / determinant,
    y: (localDotV * uLengthSquared - localDotU * uDotV) / determinant,
  }
  if (uv.x < -epsilon || uv.x > 1 + epsilon || uv.y < -epsilon || uv.y > 1 + epsilon) {
    return { hit: false, reason: "outside" }
  }
  return {
    hit: true,
    distance,
    point,
    uv: {
      x: Math.max(0, Math.min(1, uv.x)),
      y: Math.max(0, Math.min(1, uv.y)),
    },
  }
}

export function clientPointToSourceUv(
  point: SpatialPoint,
  rect: ClientRectLike,
): { readonly ok: true; readonly uv: SpatialPoint } | { readonly ok: false } {
  if (rect.width <= 0 || rect.height <= 0) return { ok: false }
  const uv = {
    x: (point.x - rect.left) / rect.width,
    y: (point.y - rect.top) / rect.height,
  }
  if (uv.x < 0 || uv.x > 1 || uv.y < 0 || uv.y > 1) return { ok: false }
  return { ok: true, uv }
}

export interface CylinderSnapResult {
  readonly point: Vector3
  readonly snapped: boolean
  readonly strength: number
}

export function softSnapPointToCylinder(
  point: Vector3,
  radius: number,
  threshold: number,
): CylinderSnapResult {
  const radialDistance = Math.hypot(point.x, point.z)
  if (radialDistance === 0 || radius <= 0 || threshold <= 0) {
    return { point, snapped: false, strength: 0 }
  }
  const difference = Math.abs(radialDistance - radius)
  if (difference > threshold) return { point, snapped: false, strength: 0 }
  const linearStrength = 1 - difference / threshold
  const strength = linearStrength * linearStrength * (3 - 2 * linearStrength)
  const snappedDistance = radialDistance + (radius - radialDistance) * strength
  const scale = snappedDistance / radialDistance
  return {
    point: { x: point.x * scale, y: point.y, z: point.z * scale },
    snapped: true,
    strength,
  }
}
