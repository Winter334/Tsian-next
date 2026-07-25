import type { WorkspaceFile } from "@tsian/contracts"
import { describe, expect, it } from "vitest"
import { FrontendActionRuntimeError } from "./errors"
import {
  FRONTEND_ACTION_DEFAULT_TIMEOUT_MS,
  FRONTEND_ACTION_MAX_HELPERS,
  FRONTEND_ACTION_SOURCE_MAX_BYTES,
  frontendActionManifestPath,
  isValidFrontendActionId,
  resolveFrontendAction,
} from "./registry"

function file(path: string, content: string, overrides: Partial<WorkspaceFile> = {}): WorkspaceFile {
  return {
    path,
    content,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  }
}

function manifest(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: 1,
    inputSchema: { type: "object" },
    outputSchema: { type: "boolean" },
    executor: { type: "browser_script", path: "run.js" },
    ...overrides,
  })
}

function resolve(files: WorkspaceFile[], actionId = "use-item") {
  return resolveFrontendAction({ gameCardId: "card-1", actionId, files })
}

function expectRuntimeCode(run: () => unknown, code: string): void {
  try {
    run()
    throw new Error("Expected function to throw.")
  } catch (error) {
    expect(error).toBeInstanceOf(FrontendActionRuntimeError)
    expect((error as FrontendActionRuntimeError).code).toBe(code)
  }
}

describe("Frontend Action registry", () => {
  it.each([
    ["a", true],
    ["use-item", true],
    ["a".repeat(64), true],
    ["", false],
    ["Use-item", false],
    ["use_item", false],
    ["-use", false],
    ["use-", false],
    ["use--item", true],
    ["a".repeat(65), false],
    [" use-item", false],
    ["../use", false],
  ])("validates action id %j", (id, expected) => {
    expect(isValidFrontendActionId(id)).toBe(expected)
  })

  it("derives only the exact manifest path", () => {
    expect(frontendActionManifestPath("use-item")).toBe("frontend-actions/use-item/action.json")
    expectRuntimeCode(() => frontendActionManifestPath("Use-item"), "FRONTEND_ACTION_MANIFEST_INVALID")
  })

  it("resolves a bound snapshot with provenance and exact resource records", () => {
    const manifestFile = file(
      "frontend-actions/use-item/action.json",
      manifest({
        executor: {
          type: "browser_script",
          path: "run.js",
          helpers: ["helpers/math.js"],
        },
      }),
    )
    const runFile = file("frontend-actions/use-item/run.js", "return true")
    const helperFile = file("frontend-actions/use-item/helpers/math.js", "globalThis.math = true")
    const action = resolve([manifestFile, runFile, helperFile])

    expect(action.timeoutMs).toBe(FRONTEND_ACTION_DEFAULT_TIMEOUT_MS)
    expect(action.resources.manifest.file).toBe(manifestFile)
    expect(action.resources.executor.file).toBe(runFile)
    expect(action.resources.helpers[0]?.file).toBe(helperFile)
    expect(action.resources.helpers[0]?.provenance).toBe("card-content")
    expect(action.resources.executor.signature).toMatchObject({
      path: runFile.path,
      createdAt: 1,
      updatedAt: 2,
      byteLength: "return true".length,
    })
  })

  it("fails loudly for missing and ambiguous exact paths", () => {
    expectRuntimeCode(() => resolve([]), "FRONTEND_ACTION_NOT_FOUND")
    const manifestFile = file("frontend-actions/use-item/action.json", manifest())
    expectRuntimeCode(
      () => resolve([manifestFile, { ...manifestFile }]),
      "FRONTEND_ACTION_MANIFEST_INVALID",
    )
    expectRuntimeCode(() => resolve([manifestFile]), "FRONTEND_ACTION_MANIFEST_INVALID")
    expectRuntimeCode(
      () => resolve([
        manifestFile,
        file("frontend-actions/use-item/run.js", "x"),
        file("frontend-actions/use-item/run.js", "y"),
      ]),
      "FRONTEND_ACTION_MANIFEST_INVALID",
    )
  })

  it("ignores malformed near-match manifest paths rather than normalizing them", () => {
    expectRuntimeCode(
      () => resolve([
        file("frontend-actions/use-item/Action.json", manifest()),
        file("frontend-actions/use-item/run.js", "return true"),
      ]),
      "FRONTEND_ACTION_NOT_FOUND",
    )
  })

  it("rejects unknown manifest and executor fields", () => {
    expectRuntimeCode(
      () => resolve([
        file("frontend-actions/use-item/action.json", manifest({ actionId: "use-item" })),
        file("frontend-actions/use-item/run.js", "return true"),
      ]),
      "FRONTEND_ACTION_MANIFEST_INVALID",
    )
    expectRuntimeCode(
      () => resolve([
        file("frontend-actions/use-item/action.json", manifest({
          executor: { type: "browser_script", path: "run.js", unknown: true },
        })),
        file("frontend-actions/use-item/run.js", "return true"),
      ]),
      "FRONTEND_ACTION_MANIFEST_INVALID",
    )
  })

  it.each(["../run.js", "helpers/../../run.js", "/run.js", "helpers\\run.js", "https://x/run.js", "./run.js"])(
    "rejects executor root escape or non-canonical path %j",
    (path) => {
      expectRuntimeCode(
        () => resolve([
          file("frontend-actions/use-item/action.json", manifest({
            executor: { type: "browser_script", path },
          })),
        ]),
        "FRONTEND_ACTION_MANIFEST_INVALID",
      )
    },
  )

  it("requires unique, bounded, declared text helpers", () => {
    expectRuntimeCode(
      () => resolve([
        file("frontend-actions/use-item/action.json", manifest({
          executor: { type: "browser_script", path: "run.js", helpers: ["h.js", "h.js"] },
        })),
        file("frontend-actions/use-item/run.js", "run"),
        file("frontend-actions/use-item/h.js", "helper"),
      ]),
      "FRONTEND_ACTION_MANIFEST_INVALID",
    )
    expectRuntimeCode(
      () => resolve([
        file("frontend-actions/use-item/action.json", manifest({
          executor: {
            type: "browser_script",
            path: "run.js",
            helpers: Array.from({ length: FRONTEND_ACTION_MAX_HELPERS + 1 }, (_, index) => `h${index}.js`),
          },
        })),
      ]),
      "FRONTEND_ACTION_MANIFEST_INVALID",
    )
    expectRuntimeCode(
      () => resolve([
        file("frontend-actions/use-item/action.json", manifest({
          executor: { type: "browser_script", path: "run.js", helpers: ["h.js"] },
        })),
        file("frontend-actions/use-item/run.js", "run"),
        file("frontend-actions/use-item/h.js", "binary", { binary: new Blob(["x"]) }),
      ]),
      "FRONTEND_ACTION_MANIFEST_INVALID",
    )
  })

  it("enforces timeout bounds and preserves an authored timeout", () => {
    const manifestFile = file("frontend-actions/use-item/action.json", manifest({
      executor: { type: "browser_script", path: "run.js", timeoutMs: 100 },
    }))
    expect(resolve([manifestFile, file("frontend-actions/use-item/run.js", "run")]).timeoutMs).toBe(100)

    for (const timeoutMs of [99, 30_001, 1.5, "100"]) {
      expectRuntimeCode(
        () => resolve([
          file("frontend-actions/use-item/action.json", manifest({
            executor: { type: "browser_script", path: "run.js", timeoutMs },
          })),
        ]),
        "FRONTEND_ACTION_MANIFEST_INVALID",
      )
    }
  })

  it("enforces executor plus helper aggregate bytes", () => {
    expectRuntimeCode(
      () => resolve([
        file("frontend-actions/use-item/action.json", manifest({
          executor: { type: "browser_script", path: "run.js", helpers: ["h.js"] },
        })),
        file("frontend-actions/use-item/run.js", "x".repeat(FRONTEND_ACTION_SOURCE_MAX_BYTES)),
        file("frontend-actions/use-item/h.js", "x"),
      ]),
      "FRONTEND_ACTION_MANIFEST_INVALID",
    )
  })
})
