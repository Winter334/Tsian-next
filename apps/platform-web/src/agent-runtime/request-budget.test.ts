import type { AgentConfig, WorkspaceFile } from "@tsian/contracts"
import { describe, expect, it, vi } from "vitest"
import { createGameRuntimeEnvironment } from "./environment"
import { estimateRuntimeMessagesTokens } from "./context-lifecycle"
import { runAgentRuntimeTurn } from "./index"

function workspace(): WorkspaceFile[] {
  const config: AgentConfig = {
    id: "agent",
    title: "Agent",
    summary: "test",
    contacts: [],
    contextPaths: [],
    skills: { enabled: [], disabled: [] },
    platformTools: { enabled: ["workspace_read"], disabled: [] },
    workspaceAccess: { level: 1 },
  }
  return [
    { path: "agents/agent/agent.json", content: JSON.stringify(config), createdAt: 1, updatedAt: 1 },
    { path: "agents/agent/AGENT.md", content: "Answer the request.", createdAt: 1, updatedAt: 1 },
  ]
}

describe("final provider request budget", () => {
  it("counts native message content and tool-call arguments", () => {
    expect(estimateRuntimeMessagesTokens([
      { role: "user", content: "x".repeat(1_000) },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "call-1", name: "read", arguments: { path: "docs/large.md" } }],
      },
    ])).toBeGreaterThan(500)
  })

  it("blocks the request before the provider is called", async () => {
    const callNative = vi.fn()
    await expect(runAgentRuntimeTurn({
      agentId: "agent",
      userInput: "x".repeat(20_000),
      recentHistory: [],
      turn: 0,
    }, createGameRuntimeEnvironment({
      workspace: { files: workspace() },
      context: {
        compressionMode: "task",
        contextCapacityTokens: 256_000,
        requestInputBudgetTokens: 100,
      },
      model: { callText: vi.fn(), callNative, toolCallMode: "native" },
      controlledTools: {},
    }))).rejects.toMatchObject({ name: "ContextBudgetExhaustedError" })
    expect(callNative).not.toHaveBeenCalled()
  })
})
