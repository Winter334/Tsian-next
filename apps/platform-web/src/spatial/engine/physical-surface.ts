import type { ClientRectLike } from "./input/coordinates"

export interface SpatialPoint {
  readonly x: number
  readonly y: number
}

export interface SpatialPoint3 extends SpatialPoint {
  readonly z: number
}

export interface SpatialSurfacePose {
  /** Positive values recede from the viewer, in CSS pixels. */
  readonly depth: number
  /** Rigid yaw around the Source center, in radians. */
  readonly yaw: number
  /** Rigid pitch around the Source center, in radians. */
  readonly pitch: number
  readonly scale: number
  /** Horizontal cylindrical half-arc, in radians. */
  readonly curveHalfAngle: number
}

export interface PhysicalSurfaceProjection {
  readonly sourceRect: ClientRectLike
  readonly viewportRect: ClientRectLike
  readonly pose: SpatialSurfacePose
  readonly parallax?: SpatialPoint
}

export interface PhysicalSurfaceVertex {
  readonly localSurface: SpatialPoint3
  readonly cameraSpace: SpatialPoint3
  readonly visualClient: SpatialPoint
  readonly perspective: number
  readonly clipW: number
}

export interface ProjectedSurfaceBounds {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly width: number
  readonly height: number
}

export interface SurfaceLocalBounds {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

export const SURFACE_FOCAL_LENGTH_FACTOR = 1
export const PHYSICAL_SURFACE_EPSILON = 1e-7
export const PHYSICAL_SURFACE_ZERO_CURVE_EPSILON = 1e-5

export const DEFAULT_SURFACE_POSE = Object.freeze<SpatialSurfacePose>({
  depth: 0,
  yaw: 0,
  pitch: 0,
  scale: 1,
  curveHalfAngle: 0,
})

export function validSurfaceRect(rect: ClientRectLike): boolean {
  return Number.isFinite(rect.left)
    && Number.isFinite(rect.top)
    && Number.isFinite(rect.width)
    && Number.isFinite(rect.height)
    && rect.width > 0
    && rect.height > 0
}

export function validSurfacePose(pose: SpatialSurfacePose): boolean {
  return Number.isFinite(pose.depth)
    && Number.isFinite(pose.yaw)
    && Number.isFinite(pose.pitch)
    && Number.isFinite(pose.scale)
    && Number.isFinite(pose.curveHalfAngle)
    && Math.abs(pose.yaw) < Math.PI / 2
    && Math.abs(pose.pitch) < Math.PI / 2
    && pose.scale > 0
    && pose.curveHalfAngle >= 0
    && pose.curveHalfAngle < Math.PI / 2
}

export function surfaceFocalLength(viewportRect: ClientRectLike): number {
  return Math.max(viewportRect.width, viewportRect.height) * SURFACE_FOCAL_LENGTH_FACTOR
}

export function localCylindricalSurfacePoint(
  local: SpatialPoint,
  halfSize: SpatialPoint,
  curveHalfAngle: number,
): SpatialPoint3 {
  if (curveHalfAngle <= PHYSICAL_SURFACE_ZERO_CURVE_EPSILON) {
    return {
      x: local.x * halfSize.x,
      y: local.y * halfSize.y,
      z: 0,
    }
  }
  const radius = halfSize.x / Math.sin(curveHalfAngle)
  const arc = local.x * curveHalfAngle
  return {
    x: Math.sin(arc) * radius,
    y: local.y * halfSize.y,
    // Camera-positive Z recedes. Negative edge Z therefore wraps both sides
    // toward the viewer while the Source center stays on its pose origin.
    z: radius * (Math.cos(arc) - 1),
  }
}

export function rotateSurfacePoint(
  localSurface: SpatialPoint3,
  yaw: number,
  pitch: number,
): SpatialPoint3 {
  const cosYaw = Math.cos(yaw)
  const sinYaw = Math.sin(yaw)
  const yawed = {
    x: cosYaw * localSurface.x + sinYaw * localSurface.z,
    y: localSurface.y,
    z: -sinYaw * localSurface.x + cosYaw * localSurface.z,
  }
  const cosPitch = Math.cos(pitch)
  const sinPitch = Math.sin(pitch)
  return {
    x: yawed.x,
    y: cosPitch * yawed.y - sinPitch * yawed.z,
    z: sinPitch * yawed.y + cosPitch * yawed.z,
  }
}

export function projectPhysicalSurfacePoint(
  local: SpatialPoint,
  projection: PhysicalSurfaceProjection,
): PhysicalSurfaceVertex | null {
  const { sourceRect, viewportRect, pose } = projection
  if (!validSurfaceRect(sourceRect)
    || !validSurfaceRect(viewportRect)
    || !validSurfacePose(pose)) return null
  const localSurface = localCylindricalSurfacePoint(
    local,
    { x: sourceRect.width / 2, y: sourceRect.height / 2 },
    pose.curveHalfAngle,
  )
  const rotated = rotateSurfacePoint(localSurface, pose.yaw, pose.pitch)
  const focalLength = surfaceFocalLength(viewportRect)
  const cameraSpace = {
    x: rotated.x * pose.scale,
    y: rotated.y * pose.scale,
    z: pose.depth + rotated.z,
  }
  if (focalLength + cameraSpace.z <= PHYSICAL_SURFACE_EPSILON) return null
  const clipW = (focalLength + cameraSpace.z) / focalLength
  const perspective = 1 / clipW
  const parallax = projection.parallax ?? { x: 0, y: 0 }
  const center = {
    x: sourceRect.left + sourceRect.width / 2 + parallax.x * viewportRect.width / 2,
    y: sourceRect.top + sourceRect.height / 2 - parallax.y * viewportRect.height / 2,
  }
  return {
    localSurface,
    cameraSpace,
    visualClient: {
      x: center.x + cameraSpace.x * perspective,
      y: center.y + cameraSpace.y * perspective,
    },
    perspective,
    clipW,
  }
}

export function projectPhysicalSurfaceBounds(
  projection: PhysicalSurfaceProjection,
  localBounds: SurfaceLocalBounds = { left: -1, top: -1, right: 1, bottom: 1 },
  segments = 32,
): ProjectedSurfaceBounds | null {
  const sampleCount = Number.isFinite(segments)
    ? Math.max(1, Math.floor(segments))
    : 32
  const points: SpatialPoint[] = []
  for (let index = 0; index <= sampleCount; index += 1) {
    const progress = index / sampleCount
    const x = localBounds.left + (localBounds.right - localBounds.left) * progress
    const y = localBounds.top + (localBounds.bottom - localBounds.top) * progress
    points.push(
      { x, y: localBounds.top },
      { x, y: localBounds.bottom },
      { x: localBounds.left, y },
      { x: localBounds.right, y },
    )
  }
  let left = Number.POSITIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const point of points) {
    const projected = projectPhysicalSurfacePoint(point, projection)
    if (!projected) return null
    left = Math.min(left, projected.visualClient.x)
    top = Math.min(top, projected.visualClient.y)
    right = Math.max(right, projected.visualClient.x)
    bottom = Math.max(bottom, projected.visualClient.y)
  }
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  }
}

export const PHYSICAL_SURFACE_VERTEX_UNIFORMS_GLSL = `
uniform vec4 u_source_rect;
uniform vec2 u_viewport_size;
uniform vec4 u_pose;
uniform float u_curve_half_angle;
uniform float u_focal_length;
uniform vec2 u_parallax;
`

/** Shared by stable, aperture, radial-mask, and ripple-particle vertices. */
export const PHYSICAL_SURFACE_TRANSFORM_GLSL = `
const float SPATIAL_ZERO_CURVE_EPSILON = 0.00001;

struct SpatialProjectedVertex {
  vec3 localSurface;
  vec3 cameraSpace;
  vec2 screen;
  float perspective;
  float clipW;
};

vec3 spatialLocalSurface(vec2 local, vec2 halfSize) {
  if (u_curve_half_angle <= SPATIAL_ZERO_CURVE_EPSILON) {
    return vec3(local * halfSize, 0.0);
  }
  float radius = halfSize.x / sin(u_curve_half_angle);
  float arc = local.x * u_curve_half_angle;
  return vec3(
    sin(arc) * radius,
    local.y * halfSize.y,
    radius * (cos(arc) - 1.0)
  );
}

vec3 spatialRotateSurface(vec3 localSurface) {
  float cosYaw = cos(u_pose.y);
  float sinYaw = sin(u_pose.y);
  vec3 yawed = vec3(
    cosYaw * localSurface.x + sinYaw * localSurface.z,
    localSurface.y,
    -sinYaw * localSurface.x + cosYaw * localSurface.z
  );
  float cosPitch = cos(u_pose.z);
  float sinPitch = sin(u_pose.z);
  return vec3(
    yawed.x,
    cosPitch * yawed.y - sinPitch * yawed.z,
    sinPitch * yawed.y + cosPitch * yawed.z
  );
}

SpatialProjectedVertex spatialProjectSurface(vec3 localSurface, float cameraDepthOffset) {
  vec3 rotated = spatialRotateSurface(localSurface);
  vec3 cameraSpace = vec3(
    rotated.x * u_pose.w,
    rotated.y * u_pose.w,
    u_pose.x + rotated.z + cameraDepthOffset
  );
  float clipW = (u_focal_length + cameraSpace.z) / u_focal_length;
  float perspective = 1.0 / clipW;
  vec2 center = u_source_rect.xy + u_source_rect.zw * 0.5;
  center += vec2(
    u_parallax.x * u_viewport_size.x * 0.5,
    -u_parallax.y * u_viewport_size.y * 0.5
  );
  SpatialProjectedVertex projected;
  projected.localSurface = localSurface;
  projected.cameraSpace = cameraSpace;
  projected.screen = center + cameraSpace.xy * perspective;
  projected.perspective = perspective;
  projected.clipW = clipW;
  return projected;
}

vec4 spatialClipPosition(SpatialProjectedVertex projected) {
  vec2 ndc = vec2(
    projected.screen.x / u_viewport_size.x * 2.0 - 1.0,
    1.0 - projected.screen.y / u_viewport_size.y * 2.0
  );
  return vec4(ndc * projected.clipW, 0.0, projected.clipW);
}
`

export function composePhysicalSurfaceVertexShader(
  declarations: string,
  main: string,
): string {
  return `#version 300 es
precision highp float;
${declarations}
${PHYSICAL_SURFACE_VERTEX_UNIFORMS_GLSL}
${PHYSICAL_SURFACE_TRANSFORM_GLSL}
${main}
`
}
