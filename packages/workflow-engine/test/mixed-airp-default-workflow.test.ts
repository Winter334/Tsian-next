import { describe, expect, it } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { createDefaultAirpWorkflow } from "../../../builtin/mods/default-airp-workflow"
import { validateWorkflowDefinition } from "../src/index"

const REPO_ROOT = resolve(__dirname, "../../..")

describe("mixed AIRP default workflow", () => {
  it("uses collection queries, public record nodes, and bounded compute retrieval", () => {
    const workflow = createDefaultAirpWorkflow()

    expect(() => validateWorkflowDefinition(workflow)).not.toThrow()
    expect(JSON.stringify(workflow)).not.toContain('"event-archive"')
    expect(JSON.stringify(workflow)).not.toContain('"apply-patch"')
    expect(JSON.stringify(workflow)).not.toContain('"bypass"')
    expect(JSON.stringify(workflow)).not.toContain("__retrieval.raw")

    expect(workflow.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "airpEvents",
          type: "memory-query",
          config: expect.objectContaining({
            source: "collection",
            namespace: "airp",
            collection: "events",
            query: "",
          }),
        }),
        expect.objectContaining({
          id: "airpArchives",
          type: "memory-query",
          config: expect.objectContaining({
            source: "collection",
            namespace: "airp",
            collection: "archives",
            query: "",
          }),
        }),
        expect.objectContaining({
          id: "airpGlobals",
          type: "memory-query",
          config: expect.objectContaining({
            source: "collection",
            namespace: "airp",
            collection: "globals",
            query: "",
          }),
        }),
        expect.objectContaining({ id: "ongoingEvents", type: "record-filter" }),
        expect.objectContaining({ id: "foregroundArchives", type: "record-filter" }),
        expect.objectContaining({ id: "selectedArchiveMerge", type: "record-merge" }),
        expect.objectContaining({ id: "selectedEventsText", type: "record-format" }),
        expect.objectContaining({ id: "selectedArchivesText", type: "record-format" }),
        expect.objectContaining({
          id: "retrieval",
          type: "compute",
          config: expect.objectContaining({
            recordRetrievalDebugOutputName: "debug",
          }),
        }),
      ]),
    )

    expect(workflow.edges).toEqual(
      expect.arrayContaining([
        {
          from: { nodeId: "retrieval", outputName: "prompt" },
          to: { nodeId: "chat", varName: "retrieval.prompt" },
        },
        {
          from: { nodeId: "retrieval", outputName: "directEntities" },
          to: { nodeId: "maintenance", varName: "retrieval.directEntities" },
        },
        {
          from: { nodeId: "retrieval", outputName: "archives" },
          to: { nodeId: "maintenance", varName: "archives.recent.json" },
        },
        {
          from: { nodeId: "maintenance", outputName: "operations" },
          to: { nodeId: "memoryWrite", varName: "operations" },
        },
      ]),
    )
  })

  it("keeps platform default workflow delegated to the shared AIRP workflow factory", () => {
    const src = readFileSync(
      resolve(REPO_ROOT, "apps/platform-web/src/workflow-host/default-workflow.ts"),
      "utf-8",
    )

    expect(src).toContain("createDefaultAirpWorkflow")
    expect(src).toContain("export const defaultWorkflow")
  })

  it("keeps memory-query collection-only across contracts and platform authoring", () => {
    const files = [
      "packages/contracts/src/workflow.ts",
      "apps/platform-web/src/workflow-host/executors/memory-query.ts",
      "apps/platform-web/src/components/workflow/inspector/MemoryQueryForm.vue",
      "apps/platform-web/src/components/workflow/node-schema.ts",
    ]

    for (const file of files) {
      const src = readFileSync(resolve(REPO_ROOT, file), "utf-8")
      expect(src, file).not.toContain("event-archive")
    }

    const executorSrc = readFileSync(
      resolve(REPO_ROOT, "apps/platform-web/src/workflow-host/executors/memory-query.ts"),
      "utf-8",
    )
    expect(executorSrc).toContain("listMemoryRecordsForSave")
    expect(executorSrc).not.toContain("assembleRetrievalContext")

    const schemaSrc = readFileSync(
      resolve(REPO_ROOT, "apps/platform-web/src/components/workflow/node-schema.ts"),
      "utf-8",
    )
    expect(schemaSrc).toContain("memory.records")
    expect(schemaSrc).toContain("memory.count")
    expect(schemaSrc).not.toContain("memory.prompt")
    expect(schemaSrc).not.toContain("memory.debug")
  })

  it("keeps apply-patch retired from workflow contracts and authoring", () => {
    const files = [
      "packages/contracts/src/workflow.ts",
      "packages/workflow-engine/src/validator.ts",
      "packages/workflow-engine/src/errors.ts",
      "packages/workflow-engine/src/index.ts",
      "apps/platform-web/src/workflow-host/index.ts",
      "apps/platform-web/src/components/workflow/node-registry.ts",
      "apps/platform-web/src/components/workflow/node-schema.ts",
      "apps/platform-web/src/components/workflow/NodeInspector.vue",
      "apps/platform-web/src/composables/useWorkflowEditor.ts",
      "apps/platform-web/src/components/workflow/WorkflowEditorCanvas.vue",
      "apps/platform-web/src/views/DebugView.vue",
    ]

    for (const file of files) {
      const src = readFileSync(resolve(REPO_ROOT, file), "utf-8")
      expect(src, file).not.toContain("apply-patch")
      expect(src, file).not.toContain("ApplyPatchNodeConfig")
      expect(src, file).not.toContain("APPLY_PATCH_INPUT_INCOMPLETE")
    }

    expect(
      existsSync(resolve(REPO_ROOT, "apps/platform-web/src/workflow-host/executors/apply-patch.ts")),
    ).toBe(false)
    expect(
      existsSync(resolve(REPO_ROOT, "apps/platform-web/src/components/workflow/inspector/ApplyPatchForm.vue")),
    ).toBe(false)
  })
})
