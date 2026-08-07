import type { AgentConfig, WorkspaceFile } from "@tsian/contracts"
import { describe, expect, it, vi } from "vitest"
import { createGameRuntimeEnvironment } from "./environment"
import { runAgentRuntimeTurn } from "./index"
import type { AgentRuntimeEnvironment } from "./turn-types"

const SKILL_CONTENT = [
  "---",
  "name: example",
  "description: Example skill",
  "---",
  "",
  "# Example Skill",
  "",
  "Follow these complete instructions.",
].join("\n")

function file(path: string, content: string): WorkspaceFile {
  return { path, content, createdAt: 1, updatedAt: 1 }
}

function workspace(): WorkspaceFile[] {
  const config: AgentConfig = {
    id: "agent",
    title: "Agent",
    summary: "Skill delivery fixture",
    contacts: [],
    contextPaths: [],
    skills: { enabled: ["skills/example/SKILL.md"], disabled: [] },
    platformTools: { enabled: [], disabled: [] },
    workspaceAccess: { level: 1 },
  }
  return [
    file("agents/agent/agent.json", JSON.stringify(config)),
    file("agents/agent/AGENT.md", "Load the requested Skill."),
    file("skills/example/SKILL.md", SKILL_CONTENT),
  ]
}

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1
}

describe("use_skill direct Tool delivery", () => {
  it("returns full Skill content in the native Tool result with no user injection", async () => {
    let round = 0
    const callNative: NonNullable<AgentRuntimeEnvironment["model"]["callNative"]> =
      vi.fn(async (
        messages: Parameters<NonNullable<AgentRuntimeEnvironment["model"]["callNative"]>>[0],
      ): ReturnType<NonNullable<AgentRuntimeEnvironment["model"]["callNative"]>> => {
        if (round++ === 0) {
          return {
            text: "",
            raw: "",
            finishReason: "tool_calls",
            toolCalls: [{ id: "skill", name: "use_skill", arguments: { name: "example" } }],
          }
        }
        const serialized = JSON.stringify(messages)
        expect(messages[messages.length - 1]?.role).toBe("tool")
        expect(serialized).toContain("# Example Skill")
        expect(occurrences(serialized, "# Example Skill")).toBe(1)
        return { text: "done", raw: "done", finishReason: "stop", toolCalls: [] }
      })

    const result = await runAgentRuntimeTurn({
      agentId: "agent",
      userInput: "use example",
      recentHistory: [],
      turn: 0,
    }, createGameRuntimeEnvironment({
      workspace: { files: workspace() },
      context: {
        compressionMode: "narrative",
        contextCapacityTokens: 256_000,
        requestInputBudgetTokens: 200_000,
      },
      model: { callText: vi.fn(), callNative, toolCallMode: "native" },
      controlledTools: {},
    }))

    expect(result.replyText).toBe("done")
  })

  it("returns full Skill content once inside the Text Tool observation", async () => {
    let round = 0
    const callText: AgentRuntimeEnvironment["model"]["callText"] = vi.fn(async (messages) => {
      if (round++ === 0) {
        return '<tsian-tool-calls>[{"name":"use_skill","arguments":{"name":"example"}}]</tsian-tool-calls>'
      }
      const serialized = JSON.stringify(messages)
      expect(serialized).toContain("# Example Skill")
      expect(occurrences(serialized, "# Example Skill")).toBe(1)
      return "done"
    })

    const result = await runAgentRuntimeTurn({
      agentId: "agent",
      userInput: "use example",
      recentHistory: [],
      turn: 0,
    }, createGameRuntimeEnvironment({
      workspace: { files: workspace() },
      context: {
        compressionMode: "narrative",
        contextCapacityTokens: 256_000,
        requestInputBudgetTokens: 200_000,
      },
      model: { callText, toolCallMode: "text" },
      controlledTools: {},
    }))

    expect(result.replyText).toBe("done")
  })
})
