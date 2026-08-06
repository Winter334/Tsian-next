// @vitest-environment happy-dom

import { createApp, nextTick, type App } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  updateSkill: vi.fn(),
  updateSkillConfig: vi.fn(),
  updateWorkspace: vi.fn(),
  updatePlatformTool: vi.fn(),
  updateTool: vi.fn(),
  refreshKnowledge: vi.fn(),
  confirm: vi.fn(async () => true),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock("@/platform-host", () => ({
  getLocalAssistantConfig: mocks.getConfig,
  updateLocalAssistantSkillEnabled: mocks.updateSkill,
  updateLocalAssistantSkillConfig: mocks.updateSkillConfig,
  updateLocalAssistantWorkspaceAccess: mocks.updateWorkspace,
  updateLocalAssistantPlatformToolEnabled: mocks.updatePlatformTool,
  updateLocalAssistantToolEnabled: mocks.updateTool,
  refreshLocalAssistantKnowledge: mocks.refreshKnowledge,
}))
vi.mock("@/composables/useConfirm", () => ({ confirm: mocks.confirm }))
vi.mock("@/composables/useToast", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}))

import { useAssistantConfigController } from "./use-assistant-config-controller"

const mounted: Array<{ app: App; host: HTMLElement }> = []

function configFixture() {
  return {
    agent: {
      id: "local", title: "助手", summary: "", configPath: "agent.json", path: "AGENT.md",
      contacts: [], defaultSkills: [], enabledSkills: ["skills/a/SKILL.md"], disabledSkills: [],
      enabledTools: [], disabledTools: [], platformTools: { enabled: ["workspace_read"], disabled: [] },
      workspaceAccess: { level: 1 }, contextPaths: [], enabledModules: [], enabledModulesConfigured: false,
      entryMode: "persistent", system: true, messageLayers: {}, updatedAt: 1,
    },
    skills: [{
      id: "a", name: "a", title: "能力 A", description: "desc", summary: "desc",
      path: "skills/a/SKILL.md", scope: "shared", triggers: [], appliesTo: [], updatedAt: 1,
      configItems: [{ key: "API_KEY", description: "密钥", defaultValue: "default" }],
    }],
    tools: [],
    toolDiagnostics: [],
    skillConfigValues: { "skills/a/SKILL.md": { API_KEY: "saved" } },
  }
}

async function mountController(onChange = vi.fn()) {
  let controller!: ReturnType<typeof useAssistantConfigController>
  const app = createApp({
    setup() {
      controller = useAssistantConfigController({ onChange })
      return () => null
    },
  })
  const host = document.createElement("div")
  document.body.append(host)
  app.mount(host)
  mounted.push({ app, host })
  await vi.waitFor(() => {
    if (!controller.agent.value) throw new Error("config not loaded")
  })
  await nextTick()
  return { controller, onChange }
}

describe("assistant config controller", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getConfig.mockImplementation(async () => configFixture())
    mocks.refreshKnowledge.mockResolvedValue({ updatedPaths: ["knowledge.md"], removedPaths: [] })
  })

  afterEach(() => {
    for (const { app, host } of mounted.splice(0)) {
      app.unmount()
      host.remove()
    }
  })

  it("shares one draft/apply contract for skill, config and workspace mutations", async () => {
    const { controller, onChange } = await mountController()
    const skill = controller.skills.value[0]
    expect(controller.skillEnabled(skill)).toBe(true)
    expect(controller.configValue(skill.path, skill.configItems![0])).toBe("saved")

    controller.toggleSkill(skill, false)
    controller.setConfigValue(skill.path, skill.configItems![0], "next")
    controller.updateWorkspaceAccessLevel(4)
    expect(controller.hasChanges.value).toBe(true)
    expect(await controller.applyChanges()).toBe(true)

    expect(mocks.updateSkill).toHaveBeenCalledWith({ skillPath: skill.path, enabled: false })
    expect(mocks.updateSkillConfig).toHaveBeenCalledWith(skill.path, { API_KEY: "next" })
    expect(mocks.updateWorkspace).toHaveBeenCalledWith(4)
    expect(onChange).toHaveBeenCalledOnce()
    expect(controller.hasChanges.value).toBe(false)
  })
})
