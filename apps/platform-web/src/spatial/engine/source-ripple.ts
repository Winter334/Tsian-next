import type { SpatialWindowRippleRenderOptions } from "./source-presentation"

const PARTICLE_COMPONENTS = 3

function hashUnit(x: number, y: number): number {
  let value = Math.imul(x + 1, 0x45d9f3b) ^ Math.imul(y + 1, 0x119de1f3)
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b)
  value ^= value >>> 16
  return (value >>> 0) / 0xffffffff
}

/** Context-initialization data only; particle motion remains entirely on the GPU. */
export function createWindowRippleParticleSeeds(
  options: SpatialWindowRippleRenderOptions,
): Float32Array {
  const columns = Math.max(1, Math.round(options.particleColumns))
  const rows = Math.max(1, Math.round(options.particleRows))
  const values = new Float32Array(columns * rows * PARTICLE_COMPONENTS)
  let offset = 0
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const seed = hashUnit(column, row)
      const jitterX = (seed - 0.5) * 0.64
      const jitterY = (hashUnit(row + 97, column + 193) - 0.5) * 0.64
      values[offset] = Math.max(0, Math.min(1, (column + 0.5 + jitterX) / columns))
      values[offset + 1] = Math.max(0, Math.min(1, (row + 0.5 + jitterY) / rows))
      values[offset + 2] = seed
      offset += PARTICLE_COMPONENTS
    }
  }
  return values
}

export function windowRippleParticleCount(options: SpatialWindowRippleRenderOptions): number {
  return Math.max(1, Math.round(options.particleColumns))
    * Math.max(1, Math.round(options.particleRows))
}

export function stableSourceRippleSeed(sourceId: string): number {
  let hash = 2166136261
  for (let index = 0; index < sourceId.length; index += 1) {
    hash ^= sourceId.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 0xffffffff
}
