import type {
  WorkspaceEntry,
  WorkspaceFile,
  WorkspaceReadResult,
} from "@tsian/contracts"
import { describe, expect, it, vi } from "vitest"
import {
  executeWorkspaceOperation,
  type WorkspaceOperationExecutionContext,
  type WorkspaceOperationVirtualReadAdapter,
} from "./workspace-operations"

function file(path: string, content: string): WorkspaceFile {
  return { path, content, createdAt: 1, updatedAt: 2 }
}

function directory(path: string): WorkspaceEntry {
  return {
    path,
    name: path.slice(path.lastIndexOf("/") + 1),
    kind: "directory",
    readOnly: true,
  }
}

function virtualFile(path: string): WorkspaceEntry {
  return {
    path,
    name: path.slice(path.lastIndexOf("/") + 1),
    kind: "file",
    readOnly: true,
  }
}

function virtualAdapter(input: {
  lists: Record<string, WorkspaceEntry[]>
  read: WorkspaceOperationVirtualReadAdapter["read"]
}): WorkspaceOperationVirtualReadAdapter {
  return {
    readonlyPathPrefixes: ["virtual"],
    list({ path }) {
      const entries = input.lists[path]
      return entries === undefined
        ? undefined
        : { path, entries, readOnly: path.startsWith("virtual") }
    },
    read: input.read,
    search: async () => undefined,
  }
}

function copyContext(input: {
  workspaceFiles?: WorkspaceFile[]
  virtualReads?: WorkspaceOperationVirtualReadAdapter
}) {
  const write = vi.fn(async (writeInput: { path: string; content?: string; data?: Blob }) =>
    file(writeInput.path, writeInput.content ?? ""))
  const context: WorkspaceOperationExecutionContext = {
    workspaceFiles: input.workspaceFiles ?? [],
    actorLevel: 4,
    exposedOperations: ["copy"],
    virtualReads: input.virtualReads,
    mutations: {
      write,
      delete: async () => ({ scope: "card-content", deletedPaths: [] }),
    },
  }
  return { context, write }
}

async function copy(path: string, targetPath: string, context: WorkspaceOperationExecutionContext) {
  return executeWorkspaceOperation({
    operation: "copy",
    scope: "card-content",
    path,
    targetPath,
  }, context) as Promise<{ copiedPaths: string[] }>
}

describe("workspace virtual copy", () => {
  it("preserves an empty virtual directory as an ordinary directory snapshot", async () => {
    const adapter = virtualAdapter({
      lists: {
        virtual: [directory("virtual/empty")],
        "virtual/empty": [],
      },
      read: async () => undefined,
    })
    const { context, write } = copyContext({ virtualReads: adapter })

    await expect(copy("virtual/empty", "snapshots/empty", context)).resolves.toEqual(
      expect.objectContaining({ copiedPaths: ["snapshots/empty/.keep"] }),
    )
    expect(write).toHaveBeenCalledOnce()
    expect(write).toHaveBeenCalledWith(expect.objectContaining({
      path: "snapshots/empty/.keep",
      content: "",
    }))
  })

  it("recursively copies nested files and nested empty directories", async () => {
    const contents: Record<string, string> = {
      "virtual/tree/root.txt": "root",
      "virtual/tree/one/two/deep.txt": "deep",
    }
    const adapter = virtualAdapter({
      lists: {
        virtual: [directory("virtual/tree")],
        "virtual/tree": [directory("virtual/tree/one"), virtualFile("virtual/tree/root.txt")],
        "virtual/tree/one": [directory("virtual/tree/one/two")],
        "virtual/tree/one/two": [
          virtualFile("virtual/tree/one/two/deep.txt"),
          directory("virtual/tree/one/two/empty"),
        ],
        "virtual/tree/one/two/empty": [],
      },
      read: async ({ path }) => {
        const content = contents[path]
        return content === undefined
          ? undefined
          : {
              path,
              content,
              createdAt: 1,
              updatedAt: 2,
              totalLines: 1,
              returnedLines: 1,
              offset: 1,
              truncated: false,
              readOnly: true,
            }
      },
    })
    const { context, write } = copyContext({ virtualReads: adapter })

    const result = await copy("virtual/tree", "snapshots/tree", context)

    expect(result.copiedPaths).toEqual([
      "snapshots/tree/one/two/deep.txt",
      "snapshots/tree/one/two/empty/.keep",
      "snapshots/tree/root.txt",
    ])
    expect(write.mock.calls.map(([input]) => [input.path, input.content])).toEqual([
      ["snapshots/tree/one/two/deep.txt", "deep"],
      ["snapshots/tree/one/two/empty/.keep", ""],
      ["snapshots/tree/root.txt", "root"],
    ])
  })

  it("reads every virtual text slice before writing the copy", async () => {
    const requestedOffsets: number[] = []
    const slices: Record<number, Omit<WorkspaceReadResult, "path" | "createdAt" | "updatedAt">> = {
      1: { content: "alpha\nbeta", totalLines: 5, returnedLines: 2, offset: 1, truncated: true },
      3: { content: "gamma\ndelta", totalLines: 5, returnedLines: 2, offset: 3, truncated: true },
      5: { content: "epsilon", totalLines: 5, returnedLines: 1, offset: 5, truncated: false },
    }
    const adapter = virtualAdapter({
      lists: { virtual: [virtualFile("virtual/paged.txt")] },
      read: async ({ path, offset }) => {
        requestedOffsets.push(offset ?? 1)
        const slice = slices[offset ?? 1]
        return slice ? { path, createdAt: 1, updatedAt: 2, ...slice } : undefined
      },
    })
    const { context, write } = copyContext({ virtualReads: adapter })

    await copy("virtual/paged.txt", "snapshots/paged.txt", context)

    expect(requestedOffsets).toEqual([1, 3, 5])
    expect(write).toHaveBeenCalledWith(expect.objectContaining({
      path: "snapshots/paged.txt",
      content: "alpha\nbeta\ngamma\ndelta\nepsilon",
    }))
  })

  it.each([
    {
      name: "invalid offset metadata",
      slice: {
        content: "line",
        totalLines: 1,
        returnedLines: 1,
        offset: 2,
        truncated: false,
      },
    },
    {
      name: "a non-advancing truncated slice",
      slice: {
        content: "",
        totalLines: 1,
        returnedLines: 0,
        offset: 1,
        truncated: true,
      },
    },
    {
      name: "empty content claiming multiple returned lines",
      slice: {
        content: "",
        totalLines: 2,
        returnedLines: 2,
        offset: 1,
        truncated: false,
      },
    },
  ])("rejects $name without writing a partial copy", async ({ slice }) => {
    const adapter = virtualAdapter({
      lists: { virtual: [virtualFile("virtual/invalid.txt")] },
      read: async ({ path }) => ({
        path,
        createdAt: 1,
        updatedAt: 2,
        ...slice,
      }),
    })
    const { context, write } = copyContext({ virtualReads: adapter })

    await expect(copy("virtual/invalid.txt", "snapshots/invalid.txt", context)).rejects.toMatchObject({
      code: "WORKSPACE_VIRTUAL_READ_INVALID",
    })
    expect(write).not.toHaveBeenCalled()
  })

  it("rejects a zero-line terminal page after a truncated slice", async () => {
    const adapter = virtualAdapter({
      lists: { virtual: [virtualFile("virtual/invalid.txt")] },
      read: async ({ path, offset }) => offset === 1
        ? {
            path,
            content: "line",
            createdAt: 1,
            updatedAt: 2,
            returnedLines: 1,
            offset: 1,
            truncated: true,
          }
        : {
            path,
            content: "",
            createdAt: 1,
            updatedAt: 2,
            returnedLines: 0,
            offset: 2,
            truncated: false,
          },
    })
    const { context, write } = copyContext({ virtualReads: adapter })

    await expect(copy("virtual/invalid.txt", "snapshots/invalid.txt", context)).rejects.toMatchObject({
      code: "WORKSPACE_VIRTUAL_READ_INVALID",
    })
    expect(write).not.toHaveBeenCalled()
  })

  it("rejects missing or inconsistent metadata on later virtual pages", async () => {
    const adapters = [
      virtualAdapter({
        lists: { virtual: [virtualFile("virtual/missing.txt")] },
        read: async ({ path, offset }) => offset === 1
          ? {
              path,
              content: "first",
              createdAt: 1,
              updatedAt: 2,
              totalLines: 2,
              returnedLines: 1,
              offset: 1,
              truncated: true,
            }
          : undefined,
      }),
      virtualAdapter({
        lists: { virtual: [virtualFile("virtual/mixed.txt")] },
        read: async ({ path, offset }) => ({
          path,
          content: offset === 1 ? "first" : "second",
          createdAt: 1,
          updatedAt: 2,
          ...(offset === 1 ? { totalLines: 2 } : {}),
          returnedLines: 1,
          offset,
          truncated: offset === 1,
        }),
      }),
    ]

    for (const adapter of adapters) {
      const sourcePath = adapter === adapters[0] ? "virtual/missing.txt" : "virtual/mixed.txt"
      const { context, write } = copyContext({ virtualReads: adapter })
      await expect(copy(sourcePath, "snapshots/invalid.txt", context)).rejects.toMatchObject({
        code: expect.stringMatching(/^WORKSPACE_VIRTUAL_READ_(?:CHANGED|INVALID)$/),
      })
      expect(write).not.toHaveBeenCalled()
    }
  })

  it("keeps ordinary eager directory copies merge-compatible", async () => {
    const { context, write } = copyContext({
      workspaceFiles: [
        file("source/a.txt", "a"),
        file("source/nested/b.txt", "b"),
        file("target/existing.txt", "existing"),
      ],
    })

    await expect(copy("source", "target", context)).resolves.toEqual(expect.objectContaining({
      copiedPaths: ["target/a.txt", "target/nested/b.txt"],
    }))
    expect(write.mock.calls.map(([input]) => input.path)).toEqual([
      "target/a.txt",
      "target/nested/b.txt",
    ])
  })

  it("preflights every exact target collision before writing any file", async () => {
    const adapter = virtualAdapter({
      lists: {
        virtual: [directory("virtual/tree")],
        "virtual/tree": [virtualFile("virtual/tree/a.txt"), virtualFile("virtual/tree/z.txt")],
      },
      read: async ({ path }) => ({
        path,
        content: path.endsWith("a.txt") ? "a" : "z",
        createdAt: 1,
        updatedAt: 2,
        totalLines: 1,
        returnedLines: 1,
        offset: 1,
        truncated: false,
      }),
    })
    const { context, write } = copyContext({
      workspaceFiles: [file("target/z.txt", "collision")],
      virtualReads: adapter,
    })

    await expect(copy("virtual/tree", "target", context)).rejects.toMatchObject({
      code: "WORKSPACE_TARGET_EXISTS",
      details: { path: "target/z.txt" },
    })
    expect(write).not.toHaveBeenCalled()
  })
})
