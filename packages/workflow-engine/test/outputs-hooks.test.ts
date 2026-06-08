import { describe, expect, it } from "vitest"

import { executeWorkflow } from "../src/index"
import type {
  OutputsStoreWriter,
  WorkflowDefinition,
  WorkflowExecutionContext,
} from "../src/index"

describe("workflow outputs hooks", () => {
  it("passes node types on init and bound inputs on start", async () => {
    const initCalls: Array<{ nodeId: string; nodeType: string }> = []
    const startInputs = new Map<string, Record<string, unknown>>()

    const writer: OutputsStoreWriter = {
      initNode(nodeId, nodeType) {
        initCalls.push({ nodeId, nodeType })
      },
      startNode(nodeId, inputs) {
        startInputs.set(nodeId, inputs)
      },
      succeedNode() {},
      failNode() {},
      abortNode() {},
      setResult() {},
    }

    const def: WorkflowDefinition = {
      nodes: [
        { id: "source", type: "compute", config: {} },
        { id: "consumer", type: "compute", config: {} },
        { id: "result1", type: "result", config: { name: "out" } },
      ],
      edges: [
        {
          from: { nodeId: "source", outputName: "raw" },
          to: { nodeId: "consumer", inputName: "text" },
        },
        {
          from: { nodeId: "consumer", outputName: "raw" },
          to: { nodeId: "result1", inputName: "value" },
        },
      ],
    }

    const context: WorkflowExecutionContext = {
      executors: new Map([
        [
          "compute",
          {
            async execute({ node, inputs }) {
              if (node.id === "source") {
                return { outputs: { raw: "hello", flag: "skip" } }
              }
              return { outputs: { raw: inputs.text } }
            },
          },
        ],
        [
          "result",
          {
            async execute({ inputs }) {
              return { outputs: { value: inputs.value } }
            },
          },
        ],
      ]),
    }

    const result = await executeWorkflow(def, context, { outputsHooks: writer })

    expect(initCalls).toEqual([
      { nodeId: "source", nodeType: "compute" },
      { nodeId: "consumer", nodeType: "compute" },
      { nodeId: "result1", nodeType: "result" },
    ])
    expect(startInputs.get("source")).toEqual({})
    expect(startInputs.get("consumer")).toEqual({ text: "hello" })
    expect(startInputs.get("result1")).toEqual({ value: "hello" })
    expect(result.results.out).toBe("hello")
  })
})
