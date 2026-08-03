import type { AgentContextEntry, SkillRegistryEntry, WorkspaceFile } from "@tsian/contracts"
import { describe, expect, it } from "vitest"
import type {
  RuntimeWorkspaceToolExecutionContext,
  RuntimeWorkspaceToolSessionState,
} from "../workspace-tools-types"
import { activateSkillByName, collectActivatedSkillContents } from "./skill-actions"

describe("use_skill delivery", () => {
  it("returns activation metadata and injects the full SKILL.md exactly once", () => {
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
      injectedSkillPaths: [],
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
    })
    expect(observation).not.toHaveProperty("content")
    expect(observation).not.toHaveProperty("actions")
    expect(sessionState.injectedSkillPaths).toEqual([])

    expect(collectActivatedSkillContents(sessionState, workspaceFiles)).toEqual([{
      name: "example",
      title: "Example",
      path: skill.path,
      content,
    }])
    expect(collectActivatedSkillContents(sessionState, workspaceFiles)).toEqual([])
  })
})
