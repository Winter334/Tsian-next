import type { WorkspaceFile } from "@tsian/contracts"
import { describe, expect, it, vi } from "vitest"
import {
  createDesktopAssistantEnvironment,
  createGameRuntimeEnvironment,
  deriveDelegatedEnvironment,
} from "./environment"

const files: WorkspaceFile[] = [
  { path: ".tsian/local/assistant/AGENT.md", content: "assistant", createdAt: 1, updatedAt: 1 },
  { path: "agents/game/AGENT.md", content: "game", createdAt: 1, updatedAt: 1 },
]
const model = { callText: vi.fn(), toolCallMode: "native" as const }
const context = {
  contextCapacityTokens: 256_000,
  requestInputBudgetTokens: 100_000,
}

describe("Agent runtime environment composition", () => {
  it("keeps desktop controlled tools out of game and delegated environments", () => {
    const queryDiagnostics = vi.fn()
    const write = vi.fn()
    const remove = vi.fn()
    const desktop = createDesktopAssistantEnvironment({
      workspace: { files, mutations: { write, delete: remove } },
      context,
      model,
      controlledTools: { queryDiagnostics, inspectFrontend: vi.fn(), testSkillScript: vi.fn() },
    })
    const game = createGameRuntimeEnvironment({
      workspace: { files },
      context: { ...context, compressionMode: "narrative" },
      model,
      controlledTools: {},
    })
    const delegated = deriveDelegatedEnvironment(desktop)

    expect(desktop.workspace.trustBoundary).toBe("trusted-authoring")
    expect(desktop.workspace.files).toBe(files)
    expect(desktop.workspace.files.map((file) => file.path)).toContain(".tsian/local/assistant/AGENT.md")
    expect(desktop.controlledTools.queryDiagnostics).toBe(queryDiagnostics)
    expect(game.workspace.trustBoundary).toBe("runtime-game-agent")
    expect(game.workspace.files).toBe(files)
    expect(game.workspace.fileFilter?.(files[0]!)).toBe(false)
    expect(game.workspace.fileFilter?.(files[1]!)).toBe(true)
    expect(game.controlledTools.queryDiagnostics).toBeUndefined()
    expect(delegated.workspace.trustBoundary).toBe("runtime-game-agent")
    expect(delegated.workspace.files).toBe(files)
    expect(delegated.workspace.fileFilter?.(files[0]!)).toBe(false)
    expect(delegated.controlledTools.queryDiagnostics).toBeUndefined()
    expect(delegated.controlledTools.inspectFrontend).toBeUndefined()
    expect(delegated.controlledTools.testSkillScript).toBeUndefined()
    expect(() => delegated.workspace.mutations?.write({
      scope: "platform-meta",
      path: ".tsian/local/assistant/notes.md",
      content: "blocked",
      ownerContext: {},
    })).toThrow(/Delegated runtime Agents/)
    expect(() => delegated.workspace.mutations?.write({
      scope: "card-content",
      path: "docs/blocked.md",
      content: "blocked",
      ownerContext: {},
    })).toThrow(/Delegated runtime Agents/)
    delegated.workspace.mutations?.write({
      scope: "save-runtime",
      path: "save/runtime.json",
      content: "{}",
      ownerContext: {},
    })
    expect(write).toHaveBeenCalledTimes(1)
  })
})
