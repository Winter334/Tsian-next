// @vitest-environment happy-dom

import { describe, expect, it } from "vitest"
import {
  planSpatialSourceMutations,
  type SpatialSourceMutationRecord,
} from "./source-mutation-routing"

function sourceFixture(sourceId = "window:one") {
  const canvas = document.createElement("canvas")
  const source = document.createElement("section")
  const content = document.createElement("div")
  source.setAttribute("data-spatial-source", sourceId)
  source.append(content)
  canvas.append(source)
  return { canvas, content, source }
}

describe("Spatial Source mutation routing", () => {
  it("dirties only the owning Source for ordinary descendant changes", () => {
    const { canvas, content } = sourceFixture()
    const text = document.createTextNode("updated")
    content.append(text)
    const records: SpatialSourceMutationRecord[] = [
      { type: "attributes", target: content, attributeName: "class" },
      { type: "characterData", target: text },
      { type: "childList", target: content, addedNodes: [text], removedNodes: [] },
    ]

    expect(planSpatialSourceMutations(canvas, records)).toEqual({
      synchronize: false,
      dirtySourceIds: ["window:one"],
    })
  })

  it("synchronizes direct Source topology changes", () => {
    const { canvas, source } = sourceFixture()
    const records: SpatialSourceMutationRecord[] = [{
      type: "childList",
      target: canvas,
      addedNodes: [source],
      removedNodes: [],
    }]

    expect(planSpatialSourceMutations(canvas, records).synchronize).toBe(true)
  })

  it("keeps dynamic-media discovery on the synchronization path", () => {
    const { canvas, content } = sourceFixture()
    const video = document.createElement("video")
    video.setAttribute("data-spatial-dynamic-media", "video")
    content.append(video)

    expect(planSpatialSourceMutations(canvas, [{
      type: "childList",
      target: content,
      addedNodes: [video],
      removedNodes: [],
    }])).toEqual({
      synchronize: true,
      dirtySourceIds: ["window:one"],
    })
  })
})
