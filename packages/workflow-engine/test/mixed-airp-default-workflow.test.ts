import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { createDefaultAirpWorkflow } from "../../../builtin/mods/default-airp-workflow"
import { validateWorkflowDefinition } from "../src/index"

const REPO_ROOT = resolve(__dirname, "../../..")

describe("mixed AIRP default workflow", () => {
  it("uses collection queries, public record nodes, and bounded compute retrieval", () => {
    const workflow = createDefaultAirpWorkflow()

    expect(() => validateWorkflowDefinition(workflow)).not.toThrow()
    expect(JSON.stringify(workflow)).not.toContain('"event-archive"')
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
})
