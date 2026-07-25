import type { WorkspaceFile } from "@tsian/contracts"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { RuntimeBrowserScriptExecutorRequest } from "../agent-runtime/workspace-tools-types"
import { isFrontendActionPath } from "../agent-runtime/frontend-action-isolation"
import { createBrowserSkillScriptRunner } from "./browser-skill-script-executor"

function file(path: string, content: string): WorkspaceFile {
  return {
    path,
    content,
    createdAt: 1,
    updatedAt: 2,
  }
}

const workspaceFiles = [
  file("skills/probe/SKILL.md", "---\nname: probe\n---\n\n# Probe"),
  file("skills/probe/scripts/run.js", "SDK_PROBE"),
  file("tools/probe/tool.json", "{}"),
  file("tools/probe/run.js", "SDK_PROBE"),
  file("frontend-actions/use-item/secret.txt", "FRONTEND_ACTION_SECRET"),
  file("frontend-actions/use-item/helper.js", "const HELPER_SECRET = true"),
  file("frontend-actions-visible/near-match.txt", "NEAR_MATCH_VISIBLE"),
]

interface WorkerPostMessage {
  type?: string
  id?: number
  source?: string
  ok?: boolean
  result?: unknown
  error?: unknown
}

class FakeBrowserScriptWorker {
  onerror: ((event: ErrorEvent) => unknown) | null = null
  onmessage: ((event: MessageEvent) => unknown) | null = null
  onmessageerror: ((event: MessageEvent) => unknown) | null = null

  private sdkResponses = new Map<number, WorkerPostMessage>()

  postMessage(message: WorkerPostMessage): void {
    if (message.type === "execute") {
      if (message.source === "SDK_PROBE") {
        const requests = [
          {
            id: 1,
            op: "workspace.read",
            args: { scope: "effective", path: "frontend-actions/use-item/secret.txt" },
          },
          {
            id: 2,
            op: "workspace.list",
            args: { scope: "effective" },
          },
          {
            id: 3,
            op: "workspace.search",
            args: { scope: "effective", query: "FRONTEND_ACTION_SECRET" },
          },
          {
            id: 4,
            op: "workspace.glob",
            args: { scope: "effective", pattern: "frontend-actions/**" },
          },
        ]
        queueMicrotask(() => {
          for (const request of requests) {
            this.emit({ type: "sdk-request", ...request })
          }
        })
        return
      }

      queueMicrotask(() => {
        this.emit({
          type: "script-result",
          ok: true,
          output: { source: message.source ?? "" },
        })
      })
      return
    }

    if (message.type === "sdk-response" && typeof message.id === "number") {
      this.sdkResponses.set(message.id, message)
      if (this.sdkResponses.size === 4) {
        const output = Object.fromEntries(
          Array.from(this.sdkResponses.entries())
            .sort(([left], [right]) => left - right)
            .map(([id, response]) => [id, response]),
        )
        queueMicrotask(() => {
          this.emit({ type: "script-result", ok: true, output })
        })
      }
    }
  }

  terminate(): void {}

  private emit(data: Record<string, unknown>): void {
    this.onmessage?.({ data } as MessageEvent)
  }
}

function transaction() {
  return {
    workspaceFiles,
    write(input: { path: string; content?: string; data?: Blob }): WorkspaceFile {
      return file(input.path, input.content ?? "")
    },
    delete(path: string) {
      return { deletedPaths: [path] }
    },
  }
}

function skillRequest(overrides: Partial<RuntimeBrowserScriptExecutorRequest> = {}) {
  return {
    ownerType: "skill" as const,
    rootDirectory: "skills/probe",
    skillName: "probe",
    skillPath: "skills/probe/SKILL.md",
    actionName: "probe",
    scriptPath: "skills/probe/scripts/run.js",
    input: {},
    timeoutMs: 1_000,
    ...overrides,
  }
}

function toolRequest(): RuntimeBrowserScriptExecutorRequest {
  return {
    ownerType: "tool",
    rootDirectory: "tools/probe",
    skillName: "probe_tool",
    skillPath: "",
    actionName: "probe_tool",
    scriptPath: "tools/probe/run.js",
    input: {},
    timeoutMs: 1_000,
  }
}

const runtimeFileFilter = (candidate: WorkspaceFile) =>
  !isFrontendActionPath(candidate.path)

beforeEach(() => {
  vi.stubGlobal("Worker", FakeBrowserScriptWorker)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("browser-script runtime Workspace isolation", () => {
  it.each([
    ["Skill", () => skillRequest()],
    ["Tool", () => toolRequest()],
  ])("filters read, list, search, and glob for a %s browser script", async (_label, request) => {
    const run = createBrowserSkillScriptRunner({ workspaceTransaction: transaction() })
    const result = await run(request(), {
      exposedWorkspaceOperations: ["read", "list", "search", "glob"],
      workspaceFileFilter: runtimeFileFilter,
    })

    expect(result.ok).toBe(true)
    const responses = result.item as Record<string, WorkerPostMessage>
    expect(responses[1]).toMatchObject({
      ok: false,
      error: { code: "WORKSPACE_FILE_NOT_FOUND" },
    })
    expect(responses[2]).toMatchObject({ ok: true })
    const listedPaths = (
      responses[2]?.result as { entries?: Array<{ path: string }> }
    )?.entries?.map((entry) => entry.path)
    expect(listedPaths).not.toContain("frontend-actions")
    expect(listedPaths).toContain("frontend-actions-visible")
    expect(responses[3]).toMatchObject({ ok: true, result: [] })
    expect(responses[4]).toMatchObject({
      ok: true,
      result: { matches: [] },
    })
  })

  it("does not load a Frontend Action file as a runtime Skill helper", async () => {
    const run = createBrowserSkillScriptRunner({ workspaceTransaction: transaction() })
    const result = await run(skillRequest({
      helpers: ["/frontend-actions/use-item/helper.js"],
    }), {
      exposedWorkspaceOperations: ["read"],
      workspaceFileFilter: runtimeFileFilter,
    })

    expect(result).toMatchObject({
      ok: false,
      error: { code: "BROWSER_SCRIPT_HELPER_NOT_FOUND" },
    })
  })

  it("preserves trusted authoring helper access without a runtime filter", async () => {
    const run = createBrowserSkillScriptRunner({ workspaceTransaction: transaction() })
    const result = await run(skillRequest({
      helpers: ["/frontend-actions/use-item/helper.js"],
    }))

    expect(result.ok).toBe(true)
    expect(result.item).toMatchObject({
      source: expect.stringContaining("const HELPER_SECRET = true"),
    })
  })
})
