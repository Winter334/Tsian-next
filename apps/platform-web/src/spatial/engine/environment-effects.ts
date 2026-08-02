export interface AtmosphericRefractionOptions {
  /** Pixel displacement amplitude. Zero keeps the seam visually disabled. */
  readonly strengthPx: number
  readonly frequency: number
  readonly speed: number
}

export interface EnvironmentPostProcessingOptions {
  readonly enabled: boolean
  /** Independent of the higher HTML Source capture scale. */
  readonly maxDimension: number
  readonly bloomScale: number
  readonly bloomThreshold: number
  readonly bloomSoftKnee: number
  readonly bloomStrength: number
  readonly bloomRadius: number
  readonly chromaticSeparationPx: number
  readonly vignetteStrength: number
  readonly grainStrength: number
  readonly atmosphericRefraction: AtmosphericRefractionOptions
  readonly decorationEnabled: boolean
}

export const DEFAULT_ENVIRONMENT_POST_PROCESSING = Object.freeze<EnvironmentPostProcessingOptions>({
  enabled: false,
  maxDimension: 1920,
  bloomScale: 0.5,
  bloomThreshold: 0.76,
  bloomSoftKnee: 0.1,
  bloomStrength: 0.24,
  bloomRadius: 1.25,
  chromaticSeparationPx: 1.35,
  vignetteStrength: 0.1,
  grainStrength: 0.012,
  atmosphericRefraction: Object.freeze({
    strengthPx: 0,
    frequency: 1.45,
    speed: 0.025,
  }),
  decorationEnabled: false,
})

export interface EnvironmentTargetSize {
  readonly width: number
  readonly height: number
  readonly bloomWidth: number
  readonly bloomHeight: number
}

export function computeEnvironmentTargetSize(
  cssWidth: number,
  cssHeight: number,
  maxTextureSize: number,
  options: EnvironmentPostProcessingOptions,
): EnvironmentTargetSize {
  const boundedMax = Math.max(1, Math.min(maxTextureSize, options.maxDimension))
  const effectScale = Math.min(1, boundedMax / Math.max(cssWidth, cssHeight, 1))
  const width = Math.max(1, Math.round(cssWidth * effectScale))
  const height = Math.max(1, Math.round(cssHeight * effectScale))
  return {
    width,
    height,
    bloomWidth: Math.max(1, Math.round(width * options.bloomScale)),
    bloomHeight: Math.max(1, Math.round(height * options.bloomScale)),
  }
}
