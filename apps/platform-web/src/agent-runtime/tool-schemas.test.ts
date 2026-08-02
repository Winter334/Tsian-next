import { describe, expect, it } from "vitest"
import { buildEnabledToolSchemas } from "./tool-schemas"

describe("controlled tool schema exposure", () => {
  it("requires both Agent config and Environment ports for desktop controlled tools", () => {
    const enabledPlatformTools = ["inspect_frontend", "test_skill_script"] as const
    const unavailable = buildEnabledToolSchemas({
      enabledPlatformTools: [...enabledPlatformTools],
      allowAgentCall: false,
      visibleContacts: [],
    }).map((tool) => tool.name)
    expect(unavailable).not.toContain("inspect_frontend")
    expect(unavailable).not.toContain("test_skill_script")

    const available = buildEnabledToolSchemas({
      enabledPlatformTools: [...enabledPlatformTools],
      allowAgentCall: false,
      visibleContacts: [],
      inspectFrontendAvailable: true,
      testSkillScriptAvailable: true,
    }).map((tool) => tool.name)
    expect(available).toContain("inspect_frontend")
    expect(available).toContain("test_skill_script")
  })

  it("exposes query_diagnostics only when config and Environment capability agree", () => {
    const base = {
      enabledPlatformTools: ["query_diagnostics"] as const,
      allowAgentCall: false,
      visibleContacts: [],
    }
    expect(buildEnabledToolSchemas({
      ...base,
      enabledPlatformTools: [...base.enabledPlatformTools],
      queryDiagnosticsAvailable: true,
    }).map((tool) => tool.name)).toContain("query_diagnostics")
    expect(buildEnabledToolSchemas({
      ...base,
      enabledPlatformTools: [...base.enabledPlatformTools],
      queryDiagnosticsAvailable: false,
    }).map((tool) => tool.name)).not.toContain("query_diagnostics")
  })
})
