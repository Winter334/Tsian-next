/**
 * memory-write schema validation boundary static proof.
 *
 * platform-web owns concrete workflow executors, while workflow-engine remains a
 * pure scheduler package. Until platform-web has its own Vitest setup, this test
 * follows the existing static-proof pattern to guard cross-layer integration.
 */

import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const REPO_ROOT = resolve(__dirname, "../../..")

const MEMORY_WRITE_EXECUTOR_FILE = resolve(
  REPO_ROOT,
  "apps/platform-web/src/workflow-host/executors/memory-write.ts",
)
const PLATFORM_WEB_PACKAGE_FILE = resolve(
  REPO_ROOT,
  "apps/platform-web/package.json",
)
const PLATFORM_WEB_TSCONFIG_FILE = resolve(
  REPO_ROOT,
  "apps/platform-web/tsconfig.app.json",
)
const PLATFORM_WEB_VITE_CONFIG_FILE = resolve(
  REPO_ROOT,
  "apps/platform-web/vite.config.ts",
)

describe("memory-write schema validation boundary", () => {
  it("platform-web declares and resolves @tsian/memory-core explicitly", () => {
    const packageJson = JSON.parse(
      readFileSync(PLATFORM_WEB_PACKAGE_FILE, "utf-8"),
    ) as { dependencies?: Record<string, string> }
    expect(packageJson.dependencies?.["@tsian/memory-core"]).toBe("0.0.0")

    const tsconfig = readFileSync(PLATFORM_WEB_TSCONFIG_FILE, "utf-8")
    expect(tsconfig).toContain('"@tsian/memory-core"')
    expect(tsconfig).toContain("../../packages/memory-core/src/index.ts")

    const viteConfig = readFileSync(PLATFORM_WEB_VITE_CONFIG_FILE, "utf-8")
    expect(viteConfig).toContain('"@tsian/memory-core"')
    expect(viteConfig).toContain("../../packages/memory-core/src/index.ts")
  })

  it("memory-write executor normalizes built-in schema operations before storage writes", () => {
    const src = readFileSync(MEMORY_WRITE_EXECUTOR_FILE, "utf-8")

    expect(src).toMatch(
      /import\s*\{[\s\S]*defaultAirpMemorySchema[\s\S]*MemoryValidationError[\s\S]*normalizeMemoryWriteOperation[\s\S]*\}\s*from\s*["@']@tsian\/memory-core["@']/,
    )
    expect(src).toContain("normalizeSchemaCoveredOperations(")
    expect(src).toContain("normalizeMemoryWriteOperation(")
    expect(src).toContain("applyMemoryWriteOperationsForSave(")

    const normalizeIndex = src.indexOf(
      "const normalizedOperations = normalizeSchemaCoveredOperations",
    )
    const storageIndex = src.indexOf("const result = await applyMemoryWriteOperationsForSave")
    expect(normalizeIndex).toBeGreaterThan(-1)
    expect(storageIndex).toBeGreaterThan(-1)
    expect(normalizeIndex).toBeLessThan(storageIndex)
  })

  it("custom memory collections remain storage-only in this slice", () => {
    const src = readFileSync(MEMORY_WRITE_EXECUTOR_FILE, "utf-8")

    expect(src).toContain("function usesBuiltInAirpSchema")
    expect(src).toContain("!defaultAirpMemorySchema.collections[collection]")
    expect(src).toMatch(
      /if\s*\(!usesBuiltInAirpSchema\(operation,\s*defaults\)\)\s*\{\s*return operation\s*\}/,
    )
  })

  it("validation issues are surfaced in the thrown workflow node error message", () => {
    const src = readFileSync(MEMORY_WRITE_EXECUTOR_FILE, "utf-8")

    expect(src).toContain("formatValidationError")
    expect(src).toContain("memory-write schema validation failed")
    expect(src).toContain("issue.code")
    expect(src).toContain("issue.path")
    expect(src).toContain("issue.message")
  })

  it("memory-write does not create a node-local checkpoint unless explicitly requested", () => {
    const src = readFileSync(MEMORY_WRITE_EXECUTOR_FILE, "utf-8")

    expect(src).toMatch(
      /if\s*\(raw\s*===\s*"manual"\)\s*return\s*"manual"[\s\S]*if\s*\(raw\s*===\s*"after-turn"\)\s*return\s*"after-turn"[\s\S]*return\s+null/,
    )
  })
})
