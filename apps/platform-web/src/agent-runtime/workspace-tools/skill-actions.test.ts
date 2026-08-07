import type { AgentContextEntry, SkillRegistryEntry, WorkspaceFile } from "@tsian/contracts"
import { describe, expect, it, vi } from "vitest"
import type {
  RuntimeWorkspaceToolExecutionContext,
  RuntimeWorkspaceToolSessionState,
} from "../workspace-tools-types"
import { activateSkillByName, executeRunScript } from "./skill-actions"

describe("use_skill delivery", () => {
  it("returns the full SKILL.md directly without duplicating action schemas", () => {
    const content = [
      "# Example Skill",
      "",
      "Full instructions that must not be duplicated in the observation.",
      "```tsian-actions",
      JSON.stringify({
        name: "run-example",
        description: "Run the example.",
        inputSchema: { type: "object", properties: { large: { type: "string" } } },
        executor: { type: "browser_script", name: "run-example", path: "scripts/run.js" },
      }),
      "```",
    ].join("\n")
    const skill = {
      id: "example",
      name: "example",
      title: "Example",
      description: "Example skill",
      scope: "global",
      path: "skills/example/SKILL.md",
    } as unknown as SkillRegistryEntry
    const workspaceFiles: WorkspaceFile[] = [{
      path: skill.path,
      content,
      createdAt: 1,
      updatedAt: 1,
    }]
    const sessionState: RuntimeWorkspaceToolSessionState = {
      loadedSkills: [],
    }
    const context = {
      workspaceFiles,
      sessionState,
      agentContext: {
        agent: { id: "assistant" },
        skillIndex: [skill],
      } as AgentContextEntry,
    } as RuntimeWorkspaceToolExecutionContext

    const observation = activateSkillByName(context, { name: "example" })
    expect(observation).toMatchObject({
      activated: true,
      actionCount: 1,
      executableActionCount: 1,
      declarationErrorCount: 0,
      content,
    })
    expect(observation).not.toHaveProperty("actions")
    expect(sessionState.loadedSkills).toHaveLength(1)

    const repeated = activateSkillByName(context, { name: "example" })
    expect(repeated).toMatchObject({ content, activated: true })
    expect(sessionState.loadedSkills).toHaveLength(1)
  })

  it("rejects oversized Skill delivery before registering activation", () => {
    const skill = {
      id: "oversized",
      name: "oversized",
      title: "Oversized",
      description: "Oversized skill",
      scope: "global",
      path: "skills/oversized/SKILL.md",
    } as unknown as SkillRegistryEntry
    const workspaceFiles: WorkspaceFile[] = [{
      path: skill.path,
      content: `# Oversized\n\n${"x".repeat(40_000)}`,
      createdAt: 1,
      updatedAt: 1,
    }]
    const sessionState: RuntimeWorkspaceToolSessionState = { loadedSkills: [] }
    const context = {
      workspaceFiles,
      sessionState,
      agentContext: {
        agent: { id: "assistant" },
        skillIndex: [skill],
      } as AgentContextEntry,
    } as RuntimeWorkspaceToolExecutionContext

    let failure: unknown
    try {
      activateSkillByName(context, { name: "oversized" })
    } catch (error) {
      failure = error
    }

    expect(failure).toMatchObject({
      code: "SKILL_DETAIL_TOO_LARGE",
      details: {
        skill: "oversized",
        actualChars: expect.any(Number),
        maxChars: expect.any(Number),
      },
    })
    expect(sessionState.loadedSkills).toEqual([])
  })

  it("passes the Agent Workspace visibility filter into the Skill script executor", async () => {
    const content = [
      "# Filtered Skill",
      "",
      "```tsian-actions",
      JSON.stringify({
        name: "run-filtered",
        description: "Run with the current Agent Workspace boundary.",
        inputSchema: { type: "object", additionalProperties: false },
        executor: { type: "browser_script", path: "scripts/run.js" },
      }),
      "```",
    ].join("\n")
    const skill = {
      id: "filtered",
      name: "filtered",
      title: "Filtered",
      description: "Filtered Skill",
      scope: "global",
      path: "skills/filtered/SKILL.md",
    } as unknown as SkillRegistryEntry
    const workspaceFiles: WorkspaceFile[] = [
      { path: skill.path, content, createdAt: 1, updatedAt: 1 },
      { path: "skills/filtered/scripts/run.js", content: "return true", createdAt: 1, updatedAt: 1 },
    ]
    const sessionState: RuntimeWorkspaceToolSessionState = { loadedSkills: [] }
    const workspaceFileFilter = (candidate: WorkspaceFile) =>
      !candidate.path.startsWith("frontend-actions/")
    const runBrowserScript = vi.fn(async (
      _request: Parameters<NonNullable<RuntimeWorkspaceToolExecutionContext["runBrowserScript"]>>[0],
      executorContext: Parameters<NonNullable<RuntimeWorkspaceToolExecutionContext["runBrowserScript"]>>[1],
    ) => {
      expect(executorContext?.workspaceFileFilter).toBe(workspaceFileFilter)
      return { ok: true as const, item: { changed: true } }
    })
    const context = {
      workspaceFiles,
      sessionState,
      agentContext: {
        agent: { id: "assistant" },
        skillIndex: [skill],
      } as AgentContextEntry,
      workspaceFileFilter,
      runBrowserScript,
    } as RuntimeWorkspaceToolExecutionContext

    activateSkillByName(context, { name: "filtered" })
    await expect(executeRunScript(context, {
      skill: "filtered",
      script: "run-filtered",
      input: {},
    })).resolves.toMatchObject({ status: "executed", output: { changed: true } })
    expect(runBrowserScript).toHaveBeenCalledTimes(1)
  })
})
