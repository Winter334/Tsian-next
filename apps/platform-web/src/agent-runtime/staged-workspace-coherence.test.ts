import type { AgentConfig, WorkspaceFile } from "@tsian/contracts"
import { describe, expect, it, vi } from "vitest"
import { createGameRuntimeEnvironment } from "./environment"
import { runAgentRuntimeTurn } from "./index"
import type { AgentRuntimeEnvironment } from "./turn-types"
import { createRuntimeWorkspaceTransaction } from "../storage/workspace"

function file(path: string, content: string): WorkspaceFile {
  return { path, content, createdAt: 1, updatedAt: 1 }
}

function workspace(): WorkspaceFile[] {
  const config: AgentConfig = {
    id: "agent",
    title: "Agent",
    summary: "staged workspace coherence fixture",
    contacts: ["assistant"],
    contextPaths: [],
    skills: { enabled: [], disabled: [] },
    tools: { enabled: ["mutate_state"], disabled: [] },
    platformTools: { enabled: ["workspace_read", "agent_call"], disabled: [] },
    workspaceAccess: { level: 1 },
  }
  return [
    file("agents/agent/agent.json", JSON.stringify(config)),
    file("agents/agent/AGENT.md", "Use the available tools."),
    file("tools/mutate-state/tool.json", JSON.stringify({
      name: "mutate_state",
      title: "Mutate state",
      description: "Mutate the staged state fixture.",
      parameters: { type: "object", additionalProperties: false },
      executor: { type: "browser_script", path: "run.js" },
    })),
    file("tools/mutate-state/run.js", "return true"),
    file("save/state.json", "before"),
    file("frontend-actions/hidden/action.json", "hidden"),
    file(".tsian/local/assistant/agent.json", JSON.stringify({
      id: "assistant",
      title: "Assistant",
      contacts: [],
      contextPaths: [],
      skills: { enabled: [], disabled: [] },
    })),
    file(".tsian/local/assistant/AGENT.md", "Hidden local assistant."),
  ]
}

type NativeCall = NonNullable<AgentRuntimeEnvironment["model"]["callNative"]>

function parseToolObservation(
  messages: Parameters<NativeCall>[0],
  toolCallId: string,
): Record<string, unknown> {
  const message = [...messages].reverse().find((candidate) =>
    candidate.role === "tool" && candidate.toolCallId === toolCallId)
  expect(message, `missing Tool observation for ${toolCallId}`).toBeDefined()
  return JSON.parse(String(message?.content)) as Record<string, unknown>
}

describe("same-turn staged Workspace coherence", () => {
  it.each([
    { mode: "write" as const, expected: '"content":"after"' },
    { mode: "delete" as const, expected: "WORKSPACE_FILE_NOT_FOUND" },
  ])("makes custom Tool $mode visible to following top-level reads", async ({ mode, expected }) => {
    const transaction = createRuntimeWorkspaceTransaction(workspace())
    let modelRound = 0
    const callNative: NativeCall = vi.fn(async (
      messages: Parameters<NativeCall>[0],
      _options: Parameters<NativeCall>[1],
      tools: Parameters<NativeCall>[2],
    ): ReturnType<NativeCall> => {
      if (modelRound === 0) {
        expect(tools.map((tool) => tool.name)).toContain("mutate_state")
        expect(tools.map((tool) => tool.name)).not.toContain("agent_call")
        modelRound += 1
        return {
          text: "",
          raw: "",
          finishReason: "tool_calls",
          toolCalls: [{ id: "mutate", name: "mutate_state", arguments: {} }],
        }
      }
      if (modelRound === 1) {
        expect(messages[messages.length - 1]).toMatchObject({ role: "tool" })
        modelRound += 1
        return {
          text: "",
          raw: "",
          finishReason: "tool_calls",
          toolCalls: [
            { id: "read", name: "read", arguments: { path: "save/state.json" } },
            { id: "list", name: "list", arguments: { path: "save" } },
            { id: "search", name: "search", arguments: { path: "save", query: "after" } },
          ],
        }
      }

      const readObservation = parseToolObservation(messages, "read")
      const listObservation = parseToolObservation(messages, "list")
      const searchObservation = parseToolObservation(messages, "search")
      expect(JSON.stringify(readObservation)).toContain(expected)
      const listedPaths = ((listObservation.entries ?? []) as Array<{ path?: string }>)
        .map((entry) => entry.path)
      const searchedPaths = ((searchObservation.items ?? []) as Array<{ path?: string }>)
        .map((entry) => entry.path)
      if (mode === "write") {
        expect(listedPaths).toContain("save/state.json")
        expect(searchedPaths).toContain("save/state.json")
      } else {
        expect(listedPaths).not.toContain("save/state.json")
        expect(searchedPaths).not.toContain("save/state.json")
      }
      return { text: "done", raw: "done", finishReason: "stop", toolCalls: [] }
    })

    const runBrowserScript: NonNullable<AgentRuntimeEnvironment["controlledTools"]["browserScript"]> =
      vi.fn(async () => {
        if (mode === "write") {
          transaction.write({ path: "save/state.json", content: "after" })
        } else {
          expect(transaction.delete("save/state.json").deletedPaths).toEqual(["save/state.json"])
        }
        return { ok: true, item: { status: "ok", changed: true } }
      })

    const result = await runAgentRuntimeTurn({
      agentId: "agent",
      userInput: "update state",
      recentHistory: [],
      turn: 0,
    }, createGameRuntimeEnvironment({
      workspace: { files: transaction.workspaceFiles },
      context: {
        compressionMode: "narrative",
        contextCapacityTokens: 256_000,
        requestInputBudgetTokens: 200_000,
      },
      model: { callText: vi.fn(), callNative, toolCallMode: "native" },
      controlledTools: { browserScript: runBrowserScript },
    }))

    expect(result.replyText).toBe("done")
    expect(callNative).toHaveBeenCalledTimes(3)
  })
})
