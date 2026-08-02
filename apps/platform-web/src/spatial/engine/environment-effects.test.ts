import { describe, expect, it } from "vitest"
import {
  computeEnvironmentTargetSize,
  DEFAULT_ENVIRONMENT_POST_PROCESSING,
} from "./environment-effects"

const enabledEffects = {
  ...DEFAULT_ENVIRONMENT_POST_PROCESSING,
  enabled: true,
}

describe("Spatial environment effect policy", () => {
  it("caps environment pixels independently and reuses a half-resolution Bloom size", () => {
    expect(computeEnvironmentTargetSize(
      2560,
      1440,
      4096,
      enabledEffects,
    )).toEqual({
      width: 1920,
      height: 1080,
      bloomWidth: 960,
      bloomHeight: 540,
    })
    expect(computeEnvironmentTargetSize(
      1280,
      720,
      4096,
      enabledEffects,
    )).toEqual({
      width: 1280,
      height: 720,
      bloomWidth: 640,
      bloomHeight: 360,
    })
  })

  it("keeps atmospheric refraction typed but visibly disabled by default", () => {
    expect(DEFAULT_ENVIRONMENT_POST_PROCESSING.atmosphericRefraction).toEqual({
      strengthPx: 0,
      frequency: 1.45,
      speed: 0.025,
    })
  })
})
