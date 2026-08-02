import {
  DEFAULT_ENVIRONMENT_POST_PROCESSING,
  type EnvironmentPostProcessingOptions,
} from "../engine/environment-effects"

/** Product-only lens treatment; other engine consumers keep the defaults. */
export const SPATIAL_DESKTOP_ENVIRONMENT_EFFECTS = Object.freeze<EnvironmentPostProcessingOptions>({
  ...DEFAULT_ENVIRONMENT_POST_PROCESSING,
  enabled: true,
  decorationEnabled: true,
})
