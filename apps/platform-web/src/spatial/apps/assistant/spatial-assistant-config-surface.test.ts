import { afterEach, describe, expect, it, vi } from "vitest"
import {
  closeSpatialAssistantConfig,
  notifySpatialAssistantConfigChanged,
  openSpatialAssistantConfig,
  useSpatialAssistantConfigState,
} from "./spatial-assistant-config-surface"

afterEach(closeSpatialAssistantConfig)

describe("Spatial Assistant config surface", () => {
  it("owns one independent request and relays changes to its invoking view", () => {
    const onChange = vi.fn()

    expect(openSpatialAssistantConfig({ onChange })).toBe(true)
    expect(openSpatialAssistantConfig()).toBe(false)
    expect(useSpatialAssistantConfigState().value).not.toBeNull()

    notifySpatialAssistantConfigChanged()
    expect(onChange).toHaveBeenCalledOnce()

    closeSpatialAssistantConfig()
    expect(useSpatialAssistantConfigState().value).toBeNull()
  })
})
