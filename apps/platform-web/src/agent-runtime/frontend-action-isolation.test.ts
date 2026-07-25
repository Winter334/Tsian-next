import type {
  WorkspaceFile,
  WorkspaceGlobResult,
  WorkspaceListResult,
  WorkspaceReadResult,
  WorkspaceSearchResult,
} from "@tsian/contracts"
import { describe, expect, it } from "vitest"
import { assembleAgentContext } from "./context"
import {
  isFrontendActionPath,
  withoutFrontendActionFiles,
} from "./frontend-action-isolation"
import {
  buildAgentRegistry,
  buildSkillRegistry,
  buildToolRegistry,
} from "./registry"
import { executeWorkspaceOperation } from "./workspace-operations"

function file(path: string, content: string): WorkspaceFile {
  return {
    path,
    content,
    createdAt: 1,
    updatedAt: 2,
  }
}

function runtimeFiles(): WorkspaceFile[] {
  return [
    file("agents/runtime/agent.json", JSON.stringify({
      id: "runtime",
      title: "Runtime Agent",
      summary: "Isolation fixture",
      contextPaths: [
        "frontend-actions/use-item/context.md",
        "prompt.md",
      ],
      knowledgeMount: "frontend-actions/use-item",
      skills: { enabled: [], disabled: [] },
      tools: { enabled: [], disabled: [] },
      platformTools: { enabled: ["workspace_read"], disabled: [] },
      workspaceAccess: { level: 1 },
    })),
    file("agents/runtime/AGENT.md", "Runtime instructions"),
    file(
      "prompt.md",
      "Visible prompt.\n{{file:frontend-actions/use-item/run.js}}",
    ),
    file(
      "skills/visible/SKILL.md",
      "---\nname: visible-skill\ndescription: Visible skill\n---\n\n# Visible",
    ),
    file("tools/visible/tool.json", JSON.stringify({
      name: "visible_tool",
      description: "Visible tool",
      parameters: { type: "object" },
      executor: { type: "browser_script", path: "run.js" },
    })),
    file("tools/visible/run.js", "return true"),
    file("docs/visible.txt", "VISIBLE_CONTENT"),
    file("frontend-actions-visible/near-match.txt", "NEAR_MATCH_VISIBLE"),
    file("frontend-actions/use-item/action.json", JSON.stringify({
      schemaVersion: 1,
      inputSchema: { type: "object" },
      outputSchema: { type: "boolean" },
      executor: { type: "browser_script", path: "run.js" },
    })),
    file("frontend-actions/use-item/run.js", "FRONTEND_ACTION_SECRET"),
    file("frontend-actions/use-item/context.md", "HIDDEN_CONTEXT_SECRET"),
    file(
      "frontend-actions/skills/hidden/SKILL.md",
      "---\nname: hidden-skill\ndescription: Hidden skill\n---\n\n# Hidden",
    ),
    file("frontend-actions/tools/hidden/tool.json", JSON.stringify({
      name: "hidden_tool",
      description: "Hidden tool",
      parameters: { type: "object" },
      executor: { type: "browser_script", path: "run.js" },
    })),
    file("frontend-actions/agents/hidden/agent.json", JSON.stringify({
      id: "hidden",
      workspaceAccess: { level: 1 },
    })),
    file("frontend-actions/agents/hidden/AGENT.md", "Hidden agent"),
  ]
}

const runtimeFileFilter = (candidate: WorkspaceFile) =>
  !isFrontendActionPath(candidate.path)

describe("Frontend Action runtime isolation", () => {
  it.each([
    ["frontend-actions", true],
    ["frontend-actions/use-item/action.json", true],
    ["frontend-actions-visible/file.json", false],
    ["frontend-action/file.json", false],
    ["Frontend-actions/file.json", false],
  ])("classifies %j as isolated=%s", (path, expected) => {
    expect(isFrontendActionPath(path)).toBe(expected)
  })

  it("removes only the exact Frontend Action namespace", () => {
    expect(withoutFrontendActionFiles(runtimeFiles()).map((candidate) => candidate.path))
      .toContain("frontend-actions-visible/near-match.txt")
    expect(withoutFrontendActionFiles(runtimeFiles()))
      .not.toEqual(expect.arrayContaining([
        expect.objectContaining({ path: "frontend-actions/use-item/run.js" }),
      ]))
  })

  it("keeps Frontend Actions out of Agent, Skill, and Tool registries", () => {
    const files = runtimeFiles()
    const agents = buildAgentRegistry(files)
    const skills = buildSkillRegistry(files)
    const { tools } = buildToolRegistry(files)

    expect(agents.map((entry) => entry.id)).toEqual(["runtime"])
    expect(skills.map((entry) => entry.name)).toEqual(["visible-skill"])
    expect(tools.map((entry) => entry.name)).toEqual(["visible_tool"])
    expect([...agents, ...skills, ...tools].map((entry) => entry.path))
      .not.toEqual(expect.arrayContaining([
        expect.stringMatching(/^frontend-actions(?:\/|$)/),
      ]))
  })

  it("hides Frontend Actions from context paths, macros, knowledge, and indexes", () => {
    const context = assembleAgentContext(runtimeFiles(), { agentId: "runtime" })

    expect(context).not.toBeNull()
    expect(context?.missingContextPaths).toEqual(expect.arrayContaining([
      "frontend-actions/use-item/context.md",
      "frontend-actions/use-item/run.js",
    ]))
    expect(context?.contextInjectionsByPosition.runtime).toEqual([
      expect.objectContaining({ content: "Visible prompt." }),
    ])
    expect(JSON.stringify(context)).not.toContain("HIDDEN_CONTEXT_SECRET")
    expect(JSON.stringify(context)).not.toContain("FRONTEND_ACTION_SECRET")
    expect(context?.knowledgeFiles).toEqual([])
    expect(context?.skillIndex.map((entry) => entry.name)).toEqual(["visible-skill"])
    expect(context?.toolIndex.map((entry) => entry.name)).toEqual(["visible_tool"])
  })

  it("hides the namespace from runtime read, list, search, and glob", async () => {
    const workspaceFiles = runtimeFiles()
    const context = {
      workspaceFiles,
      actorLevel: 1,
      exposedOperations: ["read", "list", "search", "glob"] as const,
      fileFilter: runtimeFileFilter,
    }

    await expect(executeWorkspaceOperation({
      operation: "read",
      scope: "effective",
      path: "frontend-actions/use-item/run.js",
    }, context)).rejects.toMatchObject({ code: "WORKSPACE_FILE_NOT_FOUND" })

    const listed = await executeWorkspaceOperation({
      operation: "list",
      scope: "effective",
    }, context) as WorkspaceListResult
    expect(listed.entries.map((entry) => entry.path))
      .not.toContain("frontend-actions")
    expect(listed.entries.map((entry) => entry.path))
      .toContain("frontend-actions-visible")

    const searched = await executeWorkspaceOperation({
      operation: "search",
      scope: "effective",
      query: "FRONTEND_ACTION_SECRET",
    }, context) as WorkspaceSearchResult[]
    expect(searched).toEqual([])

    const globbed = await executeWorkspaceOperation({
      operation: "glob",
      scope: "effective",
      pattern: "frontend-actions/**",
    }, context) as WorkspaceGlobResult
    expect(globbed.matches).toEqual([])
  })

  it("preserves trusted authoring visibility when no runtime filter is supplied", async () => {
    const context = {
      workspaceFiles: runtimeFiles(),
      actorLevel: 4,
      exposedOperations: ["read", "list", "search", "glob"] as const,
    }

    const read = await executeWorkspaceOperation({
      operation: "read",
      scope: "effective",
      path: "frontend-actions/use-item/run.js",
    }, context) as WorkspaceReadResult
    expect(read.content).toBe("FRONTEND_ACTION_SECRET")

    const listed = await executeWorkspaceOperation({
      operation: "list",
      scope: "effective",
    }, context) as WorkspaceListResult
    expect(listed.entries.map((entry) => entry.path)).toContain("frontend-actions")

    const searched = await executeWorkspaceOperation({
      operation: "search",
      scope: "effective",
      query: "FRONTEND_ACTION_SECRET",
    }, context) as WorkspaceSearchResult[]
    expect(searched.map((entry) => entry.path))
      .toContain("frontend-actions/use-item/run.js")

    const globbed = await executeWorkspaceOperation({
      operation: "glob",
      scope: "effective",
      pattern: "frontend-actions/**",
    }, context) as WorkspaceGlobResult
    expect(globbed.matches).toEqual(expect.arrayContaining([
      "frontend-actions/use-item/action.json",
      "frontend-actions/use-item/run.js",
    ]))
  })
})
