import type { WorkspaceFile } from "@tsian/contracts"
import { describe, expect, it } from "vitest"
import type {
  FrontendActionWorkspaceDependencyTracker,
  FrontendActionWorkspaceSnapshot,
} from "@/storage/frontend-action-workspace"
import { createRuntimeWorkspaceTransaction } from "@/storage/workspace"
import { createFrontendActionWorkspaceAdapter } from "./workspace-adapter"
import { FrontendActionRuntimeError } from "./errors"

function file(path: string, content: string, binary?: Blob): WorkspaceFile {
  return {
    path,
    content,
    ...(binary ? { binary } : {}),
    createdAt: 1,
    updatedAt: 2,
  }
}

function harness(files: WorkspaceFile[]) {
  const recorded: string[] = []
  const transaction = createRuntimeWorkspaceTransaction(files)
  const tracker = {
    recordFile: (scope, path) => {
      recorded.push(`file:${scope}:${String(path)}`)
      return {} as never
    },
    recordList: (scope, path) => {
      recorded.push(`list:${scope}:${String(path ?? "")}`)
      return {} as never
    },
    recordGlob: (scope, pattern, limit) => {
      recorded.push(`glob:${scope}:${String(pattern)}:${String(limit)}`)
      return {} as never
    },
    recordWriteBaseline: (path) => {
      recorded.push(`write:${String(path)}`)
      return {} as never
    },
    recordDeleteRange: (path) => {
      recorded.push(`delete:${String(path)}`)
      return {} as never
    },
    dependencies: [],
    deletePrefixes: [],
    readSet: () => ({ dependencies: [], deletePrefixes: [] }),
  } satisfies FrontendActionWorkspaceDependencyTracker
  const execute = createFrontendActionWorkspaceAdapter({
    invocationId: "invocation-1",
    snapshot: {} as FrontendActionWorkspaceSnapshot,
    transaction,
    dependencies: tracker,
  })
  return { execute, recorded, transaction }
}

async function expectExecutionFailure(promise: Promise<unknown>): Promise<void> {
  try {
    await promise
    throw new Error("Expected execution failure.")
  } catch (error) {
    expect(error).toBeInstanceOf(FrontendActionRuntimeError)
    expect((error as FrontendActionRuntimeError).code).toBe("FRONTEND_ACTION_EXECUTION_FAILED")
  }
}

describe("Frontend Action Workspace adapter", () => {
  it("records reads and provides staged read-your-writes", async () => {
    const context = harness([file("save/state.json", "before")])
    await context.execute({
      op: "workspace.write",
      args: { scope: "save-runtime", path: "save/state.json", content: "after" },
    })
    const result = await context.execute({
      op: "workspace.read",
      args: { scope: "save-runtime", path: "save/state.json" },
    })
    expect(result).toMatchObject({ path: "save/state.json", content: "after" })
    expect(context.recorded).toEqual([
      "write:save/state.json",
      "file:save-runtime:save/state.json",
    ])
  })

  it("records list, glob, and initially-empty delete ranges", async () => {
    const context = harness([file("save/a.txt", "a")])
    await context.execute({ op: "workspace.list", args: { scope: "save-runtime", path: "save" } })
    await context.execute({ op: "workspace.glob", args: { scope: "save-runtime", pattern: "save/*.txt", limit: 10 } })
    await context.execute({ op: "workspace.delete", args: { scope: "save-runtime", path: "save/missing" } })
    expect(context.recorded).toEqual([
      "list:save-runtime:save",
      "glob:save-runtime:save/*.txt:10",
      "delete:save/missing",
    ])
  })

  it("returns null for a missing read while keeping its dependency", async () => {
    const context = harness([])
    await expect(context.execute({
      op: "workspace.read",
      args: { scope: "save-runtime", path: "save/missing.json" },
    })).resolves.toBeNull()
    expect(context.recorded).toEqual([
      "file:save-runtime:save/missing.json",
    ])
  })

  it("rejects forbidden operations, scopes, binary reads, and non-text writes", async () => {
    await expectExecutionFailure(harness([]).execute({ op: "workspace.search", args: {} }))
    await expectExecutionFailure(harness([]).execute({
      op: "workspace.write",
      args: { scope: "card-content", path: "file.txt", content: "x" },
    }))
    await expectExecutionFailure(harness([file("asset.bin", "binary", new Blob(["x"]))]).execute({
      op: "workspace.read",
      args: { scope: "effective", path: "asset.bin" },
    }))
    await expectExecutionFailure(harness([]).execute({
      op: "workspace.write",
      args: { scope: "save-runtime", path: "save/value.bin", content: { bad: true } },
    }))
  })

  it("does not expose Frontend Action resources to business reads", async () => {
    const context = harness([
      file("frontend-actions/use-item/action.json", "{}"),
      file("story.txt", "visible"),
    ])
    const list = await context.execute({ op: "workspace.list", args: { scope: "effective" } })
    expect(list).toMatchObject({ entries: [{ path: "story.txt" }] })
    const glob = await context.execute({
      op: "workspace.glob",
      args: { scope: "effective", pattern: "**/*.json" },
    })
    expect(glob).toMatchObject({ matches: [] })
    await expectExecutionFailure(context.execute({
      op: "workspace.read",
      args: { scope: "effective", path: "frontend-actions/use-item/action.json" },
    }))
  })
})
