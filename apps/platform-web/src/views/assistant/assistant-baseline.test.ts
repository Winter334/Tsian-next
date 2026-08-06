// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest"
import { createApp, h, nextTick, reactive, type App, type Component } from "vue"
import type { ChatMessage } from "@/composables/useAssistantTimeline"
import AssistantAskPanel from "./AssistantAskPanel.vue"
import AssistantMessageList from "./AssistantMessageList.vue"

const mountedApps: App[] = []

function mount(component: Component, props: Record<string, unknown>): HTMLElement {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const app = createApp({ render: () => h(component, props) })
  app.mount(host)
  mountedApps.push(app)
  return host
}

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ""
})

describe("RetroOS Assistant baseline", () => {
  it("renders custom ask input by explicit normalized state", () => {
    const withCustom = mount(AssistantAskPanel, {
      activeAsk: {
        requestId: "ask-1",
        question: "Choose or explain",
        options: ["A", "B"],
        allowCustom: true,
      },
    })
    expect(withCustom.querySelectorAll("button")).toHaveLength(4)
    expect(withCustom.querySelector("input[placeholder='自定义回答…']")).not.toBeNull()

    const openEnded = mount(AssistantAskPanel, {
      activeAsk: {
        requestId: "ask-open",
        question: "Explain",
        allowCustom: true,
      },
    })
    expect(openEnded.querySelector("input[placeholder='自定义回答…']")).not.toBeNull()

    const optionsOnly = mount(AssistantAskPanel, {
      activeAsk: {
        requestId: "ask-2",
        question: "Choose",
        options: ["A"],
        allowCustom: false,
      },
    })
    expect(optionsOnly.querySelector("input[placeholder='自定义回答…']")).toBeNull()
  })

  it("renders one ordered process fold with direct Tool rows", async () => {
    const messages = reactive<ChatMessage[]>([{
      role: "assistant",
      content: "done",
      processCollapsed: true,
      timeline: [
        { type: "interim", id: "interim", round: 0, text: "准备执行", collapsed: false },
        {
          type: "tool",
          id: "tool-a",
          round: 0,
          name: "read",
          displayName: "读取资料",
          status: "success",
          collapsed: true,
        },
        {
          type: "tool",
          id: "tool-b",
          round: 0,
          name: "agent_call",
          status: "failed",
          collapsed: true,
          presentation: {
            type: "agent_call",
            targetAgent: { id: "worker", title: "Worker" },
            response: "",
            status: "failed",
            error: { code: "FAILED", message: "delegation failed" },
          },
        },
      ],
    }])

    const closedHost = mount(AssistantMessageList, {
      messages,
      sending: false,
      activeAsk: null,
      copiedIndex: null,
      editingIndex: null,
    })

    expect(closedHost.querySelectorAll(".assistant-process")).toHaveLength(1)
    expect(closedHost.textContent).toContain("2 次工具调用")
    expect(closedHost.textContent).not.toContain("读取了")
    expect(closedHost.querySelector(".assistant-process__trigger")?.getAttribute("aria-expanded")).toBe("false")

    messages[0]!.processCollapsed = false
    await nextTick()
    const host = mount(AssistantMessageList, {
      messages,
      sending: false,
      activeAsk: null,
      copiedIndex: null,
      editingIndex: null,
    })
    expect(host.querySelector(".assistant-process__trigger")?.getAttribute("aria-expanded")).toBe("true")
    expect(host.querySelectorAll(".assistant-process__tool")).toHaveLength(2)
    expect(host.textContent).toContain("读取资料")
    expect(host.textContent).toContain("成功")
    expect(host.textContent).toContain("agent_call")
    expect(host.textContent).toContain("失败")
    expect(host.textContent).toContain("Worker")
    expect(host.textContent).toContain("delegation failed")
    expect(host.textContent.indexOf("读取资料")).toBeLessThan(host.textContent.indexOf("agent_call"))
    expect(messages[0]?.timeline?.map((node) => node.id)).toEqual(["interim", "tool-a", "tool-b"])
  })
})
