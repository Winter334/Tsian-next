import { describe, expect, it } from "vitest"
import { acceptToolObservationForAgent, MAX_AGENT_OBSERVATION_CHARS } from "./observations"
import { deliverInspectFrontendResultToAgent } from "./specialized-delivery"

describe("specialized Tool delivery", () => {
  it("bounds inspect_frontend aggregate output before final acceptance", () => {
    const raw = {
      ok: true,
      operation: "inspect",
      cardId: "card",
      entry: "index.html",
      structure: {
        domSummary: "d".repeat(8_000),
        renderedText: "r".repeat(8_000),
        computedStyles: Array.from({ length: 80 }, (_, index) => ({
          selector: `#item-${index}`,
          style: "s".repeat(1_000),
        })),
        bridgeState: "ready",
      },
      diagnostics: {
        errors: Array.from({ length: 50 }, () => ({
          message: "error".repeat(300),
          stack: "stack".repeat(1_000),
        })),
        console: Array.from({ length: 100 }, () => ({
          level: "warn",
          args: ["arg".repeat(300)],
        })),
        resourceFailures: Array.from({ length: 50 }, (_, index) => ({
          url: `https://example.invalid/${index}`,
          reason: "failed",
        })),
        bridgeHandshake: "ready",
      },
      interactables: Array.from({ length: 80 }, (_, index) => ({
        ref: `ref-${index}`,
        kind: "button",
        name: "button".repeat(200),
        selector: `#button-${index}`,
        visible: true,
      })),
      activity: Array.from({ length: 200 }, (_, index) => ({
        sequence: index,
        requestId: `request-${index}`,
        method: "interaction.sendMessage",
        phase: "completed",
        relativeMs: index,
      })),
    }

    const delivered = deliverInspectFrontendResultToAgent(raw) as Record<string, unknown>
    const accepted = acceptToolObservationForAgent(
      { name: "inspect_frontend", arguments: { operation: "inspect" } },
      { index: 0, name: "inspect_frontend", ok: true, result: delivered },
    )
    expect(accepted.ok).toBe(true)
    expect(JSON.stringify(accepted).length).toBeLessThanOrEqual(MAX_AGENT_OBSERVATION_CHARS)
    expect(delivered).toMatchObject({
      truncated: true,
      delivery: {
        aggregateReduced: true,
        omitted: { interactables: 75 },
      },
    })
  })

  it("omits explicit undefined fields for finish results", () => {
    const delivered = deliverInspectFrontendResultToAgent({
      ok: true,
      operation: "finish",
      cardId: "card",
      entry: "index.html",
      frameGeneration: undefined,
      debugSession: undefined,
      structure: {
        domSummary: "",
        renderedText: undefined,
        computedStyles: [],
        bridgeState: "ready",
      },
      diagnostics: {
        errors: [{ message: "previous", source: undefined }],
        console: [],
        resourceFailures: [],
        bridgeHandshake: "ready",
      },
      wait: {
        mode: "none",
        status: "not-requested",
        waitedMs: 0,
        activityBefore: 0,
        activityAfter: 0,
        triggered: undefined,
      },
      restored: { restored: true, restoredTurn: 2, reloadReady: true },
      interactables: undefined,
      actions: undefined,
    }) as Record<string, unknown>

    expect(delivered).not.toHaveProperty("frameGeneration")
    expect(delivered).not.toHaveProperty("interactables")
    expect(delivered).not.toHaveProperty("structure.renderedText")
    expect(acceptToolObservationForAgent(
      { name: "inspect_frontend", arguments: { operation: "finish" } },
      { index: 0, name: "inspect_frontend", ok: true, result: delivered },
    ).ok).toBe(true)
  })

  it("bounds observe-mode interactables, actions, targets, and effects", () => {
    const delivered = deliverInspectFrontendResultToAgent({
      ok: true,
      operation: "inspect",
      cardId: "card",
      entry: "index.html",
      structure: {
        domSummary: "screen",
        renderedText: "screen",
        computedStyles: [],
        bridgeState: "ready",
      },
      diagnostics: {
        errors: [],
        console: [],
        resourceFailures: [],
        bridgeHandshake: "ready",
      },
      interactables: [{
        ref: "r".repeat(2_000),
        kind: "button",
        name: "n".repeat(2_000),
        selector: "#" + "s".repeat(3_000),
        visible: true,
        disabled: undefined,
      }],
      actions: [{
        step: 1,
        action: {
          type: "fill",
          selector: "#" + "a".repeat(3_000),
          text: "t".repeat(3_000),
          checked: undefined,
        },
        ok: true,
        matchedCount: 1,
        target: {
          tag: "input",
          role: "textbox",
          name: "x".repeat(2_000),
          selector: "#" + "b".repeat(3_000),
          visible: true,
          readonly: undefined,
        },
        effect: {
          domChanged: true,
          bridgeTriggered: false,
          ignored: "z".repeat(40_000),
        },
      }],
    }) as Record<string, unknown>
    const interactable = (delivered.interactables as Array<Record<string, unknown>>)[0]!
    const actionResult = (delivered.actions as Array<Record<string, unknown>>)[0]!
    const action = actionResult.action as Record<string, unknown>
    const target = actionResult.target as Record<string, unknown>

    expect(interactable.ref).toHaveLength(500)
    expect(interactable.name).toHaveLength(500)
    expect(interactable.selector).toHaveLength(1_000)
    expect(interactable).not.toHaveProperty("disabled")
    expect(action.selector).toHaveLength(1_000)
    expect(action.text).toHaveLength(1_000)
    expect(target.name).toHaveLength(500)
    expect(target.selector).toHaveLength(1_000)
    expect(actionResult.effect).toEqual({ domChanged: true, bridgeTriggered: false })
    expect(acceptToolObservationForAgent(
      { name: "inspect_frontend", arguments: { operation: "inspect", observeBetween: true } },
      { index: 0, name: "inspect_frontend", ok: true, result: delivered },
    ).ok).toBe(true)
  })
})
