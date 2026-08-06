// @vitest-environment happy-dom

import { createApp, ref, type App } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const integration = vi.hoisted(() => ({
  controller: null as Record<string, unknown> | null,
  routerPush: vi.fn(),
}))

vi.mock("@/controllers/studio/use-studio-controller", () => ({
  STUDIO_WORKSPACE_ACCESS_OPTIONS: [
    { level: 0, label: "只读" },
    { level: 1, label: "可维护存档" },
  ],
  useStudioController: () => integration.controller,
}))
vi.mock("vue-router", () => ({ useRouter: () => ({ push: integration.routerPush }) }))

import SpatialStudioView from "./SpatialStudioView.vue"

const mounted: Array<{ app: App; host: HTMLElement }> = []

function mount(): HTMLElement {
  const host = document.createElement("div")
  document.body.append(host)
  const app = createApp(SpatialStudioView)
  app.mount(host)
  mounted.push({ app, host })
  return host
}

function buttonByText(host: HTMLElement, text: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.includes(text))
}

describe("Spatial Studio controller integration", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const agent = {
      id: "agent", path: "agents/agent/AGENT.md", title: "主 Agent", summary: "负责协调",
      system: true, providerPresetId: "", workspaceAccess: { level: 1 },
    }
    const skill = { path: "skills/a/SKILL.md", title: "能力 A", description: "执行能力 A" }
    integration.controller = {
      snapshot: ref({ card: { id: "card" }, agents: [agent] }),
      agentContext: ref({}),
      loading: ref(false),
      contextLoading: ref(false),
      errorMessage: ref(""),
      feedbackMessage: ref("已同步"),
      selectedAgentId: ref("agent"),
      selectedAgent: ref(agent),
      agentDraft: ref("Agent 指令"),
      soulDraft: ref("Soul 指令"),
      togglingSkillPath: ref(""),
      deletingSkillPath: ref(""),
      updatingWorkspaceAccess: ref(false),
      updatingProviderPreset: ref(false),
      providerPresetOptions: ref([{ id: "provider", name: "Provider" }]),
      providerPresetDescription: ref("平台默认"),
      cardTitle: ref("测试卡"),
      agentFilePath: ref("agents/agent/AGENT.md"),
      soulFilePath: ref("agents/agent/SOUL.md"),
      skillsForSelectedAgent: ref([skill]),
      modulesForSelectedAgent: ref([{ path: "modules/rule.md", title: "规则" }]),
      toolDiagnostics: ref([]),
      runtimeCapabilities: ref([{ key: "read", title: "读取", badge: "平台", description: "读取 Workspace", enabled: true, disabled: false }]),
      enabledRuntimeCapabilityCount: ref(1),
      workspaceAccessDescription: ref("可维护存档"),
      statusLabel: ref("READY"),
      isNoCardError: ref(false),
      entrySummary: (value: string) => value,
      skillEnabled: vi.fn(() => true),
      enabledSkillCount: vi.fn(() => 1),
      refresh: vi.fn(),
      selectAgent: vi.fn(),
      selectAgentById: vi.fn(),
      toggleSkill: vi.fn(),
      deleteSkill: vi.fn(),
      toggleRuntimeCapability: vi.fn(),
      updateWorkspaceAccessLevel: vi.fn(),
      updateProviderPreset: vi.fn(),
      openWorkspace: vi.fn(),
      openPathDirectory: vi.fn(),
      goToLibrary: vi.fn(),
      goToMarket: vi.fn(),
    }
  })

  afterEach(() => {
    for (const { app, host } of mounted.splice(0)) {
      app.unmount()
      host.remove()
    }
  })

  it("renders Agent-centered controls through Spatial primitives and shared controller commands", () => {
    const host = mount()
    expect(host.querySelector("select")).toBeNull()
    expect(host.querySelector('[class*="retro-"]')).toBeNull()
    expect(host.textContent).toContain("主 Agent")
    expect(host.textContent).toContain("Agent 指令")
    buttonByText(host, "主 Agent")?.click()
    expect(integration.controller?.selectAgent).toHaveBeenCalled()
    buttonByText(host, "编辑")?.click()
    expect(integration.routerPush).toHaveBeenCalledWith({
      name: "workspace-editor",
      query: { cardId: "card", path: "agents/agent/AGENT.md", mode: "edit" },
    })
  })
})
