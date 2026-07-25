import type { WorkspaceFile } from "@tsian/contracts"
import { describe, expect, it, vi } from "vitest"
import { FrontendActionRuntimeError } from "./errors"
import { resolveFrontendAction } from "./registry"
import { validateAndInlineFrontendActionImports } from "./imports"

function file(path: string, content: string): WorkspaceFile {
  return { path, content, createdAt: 1, updatedAt: 2 }
}

function action(
  source: string,
  helpers: Array<string | { path: string; content: string }> = [],
) {
  const manifestPath = "frontend-actions/use-item/action.json"
  const normalizedHelpers = helpers.map((helper) => (
    typeof helper === "string"
      ? { path: helper, content: `globalThis[${JSON.stringify(helper)}] = true` }
      : helper
  ))
  return resolveFrontendAction({
    gameCardId: "card-1",
    actionId: "use-item",
    files: [
      file(manifestPath, JSON.stringify({
        schemaVersion: 1,
        inputSchema: true,
        outputSchema: true,
        executor: {
          type: "browser_script",
          path: "run.js",
          helpers: normalizedHelpers.map((helper) => helper.path),
        },
      })),
      file("frontend-actions/use-item/run.js", source),
      ...normalizedHelpers.map((helper) => file(
        `frontend-actions/use-item/${helper.path}`,
        helper.content,
      )),
    ],
  })
}

function importedPaths(result: ReturnType<typeof validateAndInlineFrontendActionImports>): string[] {
  return result.importedResources.map((resource) => resource.file.path)
}

async function execute(source: string, input: unknown = {}): Promise<unknown> {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
    ...args: string[]
  ) => (...values: unknown[]) => Promise<unknown>
  return new AsyncFunction("input", source)(input)
}

function expectManifestInvalid(run: () => unknown): void {
  try {
    run()
    throw new Error("Expected manifest error.")
  } catch (error) {
    expect(error).toBeInstanceOf(FrontendActionRuntimeError)
    expect((error as FrontendActionRuntimeError).code).toBe("FRONTEND_ACTION_MANIFEST_INVALID")
  }
}

describe("Frontend Action static imports", () => {
  it("does not execute or depend on an unused declared helper", async () => {
    const marker = vi.fn()
    vi.stubGlobal("__frontendActionMarker", marker)
    try {
      const result = validateAndInlineFrontendActionImports(action(
        "return true",
        [{ path: "helpers/unused.js", content: "globalThis.__frontendActionMarker('unused')" }],
      ))

      expect(importedPaths(result)).toEqual([])
      await expect(execute(result.source)).resolves.toBe(true)
      expect(marker).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("preserves conditional branch semantics", async () => {
    const marker = vi.fn()
    vi.stubGlobal("__frontendActionMarker", marker)
    try {
      const result = validateAndInlineFrontendActionImports(action(
        `if (input.load) importScripts("./helpers/conditional.js");\nreturn true`,
        [{
          path: "helpers/conditional.js",
          content: "globalThis.__frontendActionMarker('conditional')",
        }],
      ))

      await execute(result.source, { load: false })
      expect(marker).not.toHaveBeenCalled()
      await execute(result.source, { load: true })
      expect(marker).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("preserves function-local call timing", async () => {
    const marker = vi.fn()
    vi.stubGlobal("__frontendActionMarker", marker)
    try {
      const result = validateAndInlineFrontendActionImports(action(
        `function loadHelper() { importScripts("helpers/local.js"); }\nif (input.load) loadHelper();\nreturn true`,
        [{ path: "helpers/local.js", content: "globalThis.__frontendActionMarker('local')" }],
      ))

      await execute(result.source, { load: false })
      expect(marker).not.toHaveBeenCalled()
      await execute(result.source, { load: true })
      expect(marker).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("executes helpers in call-site and argument order", async () => {
    const calls: string[] = []
    vi.stubGlobal("__frontendActionMarker", (value: string) => calls.push(value))
    try {
      const result = validateAndInlineFrontendActionImports(action(
        `globalThis.__frontendActionMarker("before");\nimportScripts("helpers/one.js", "helpers/two.js");\nglobalThis.__frontendActionMarker("after");\nreturn true`,
        [
          { path: "helpers/one.js", content: "globalThis.__frontendActionMarker('one')" },
          { path: "helpers/two.js", content: "globalThis.__frontendActionMarker('two')" },
        ],
      ))

      await execute(result.source)
      expect(calls).toEqual(["before", "one", "two", "after"])
      expect(importedPaths(result)).toEqual([
        "frontend-actions/use-item/helpers/one.js",
        "frontend-actions/use-item/helpers/two.js",
      ])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("executes duplicate calls repeatedly while deduplicating the resource dependency", async () => {
    const marker = vi.fn()
    vi.stubGlobal("__frontendActionMarker", marker)
    try {
      const result = validateAndInlineFrontendActionImports(action(
        `importScripts("helpers/repeated.js");\nimportScripts("helpers/repeated.js");\nreturn true`,
        [{ path: "helpers/repeated.js", content: "globalThis.__frontendActionMarker('run')" }],
      ))

      await execute(result.source)
      expect(marker).toHaveBeenCalledTimes(2)
      expect(importedPaths(result)).toEqual([
        "frontend-actions/use-item/helpers/repeated.js",
      ])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("validates and executes statically imported helper dependencies", async () => {
    const calls: string[] = []
    vi.stubGlobal("__frontendActionMarker", (value: string) => calls.push(value))
    try {
      const result = validateAndInlineFrontendActionImports(action(
        `importScripts("helpers/one.js");\nreturn true`,
        [
          {
            path: "helpers/one.js",
            content: `globalThis.__frontendActionMarker("one-before");\nimportScripts("helpers/two.js");\nglobalThis.__frontendActionMarker("one-after")`,
          },
          { path: "helpers/two.js", content: "globalThis.__frontendActionMarker('two')" },
        ],
      ))

      await execute(result.source)
      expect(calls).toEqual(["one-before", "two", "one-after"])
      expect(importedPaths(result)).toEqual([
        "frontend-actions/use-item/helpers/one.js",
        "frontend-actions/use-item/helpers/two.js",
      ])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("validates dynamic calls even inside an unused declared helper", () => {
    expectManifestInvalid(() => validateAndInlineFrontendActionImports(action(
      "return true",
      [{ path: "helpers/unused.js", content: "importScripts(path)" }],
    )))
  })

  it.each([
    `importScripts(path)`,
    `importScripts("helpers/math.js", path)`,
    `importScripts()`,
    `importScripts?.("helpers/math.js")`,
    `importScripts("../outside.js")`,
    `importScripts("%2e%2e/outside.js")`,
    `importScripts("helpers/undeclared.js")`,
  ])("rejects a dynamic, mixed, escaping, or undeclared import: %s", (source) => {
    expectManifestInvalid(() => validateAndInlineFrontendActionImports(action(
      source,
      ["helpers/math.js"],
    )))
  })
})
