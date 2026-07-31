import { describe, expect, it } from "vitest"
import { SpatialMetrics } from "./metrics"

describe("SpatialMetrics", () => {
  it("records frames, uploads, resources, reasons and failures", () => {
    const metrics = new SpatialMetrics()
    metrics.recordFrame(2)
    metrics.recordFrame(4)
    metrics.recordUpload(128.4)
    metrics.setTextureCount(3)
    metrics.recordDisposal(2)
    metrics.setRasterPolicy(1, 2)
    metrics.setActiveReasons(["parallax", "dirty", "dirty"])
    metrics.recordFailure("upload failed")
    expect(metrics.snapshot()).toEqual({
      frameCount: 2,
      lastFrameTimeMs: 4,
      averageFrameTimeMs: 3,
      uploadCount: 1,
      uploadedBytesEstimate: 128,
      textureCount: 3,
      disposalCount: 2,
      displayDpr: 1,
      internalRasterScale: 2,
      activeReasons: ["dirty", "parallax"],
      lastFailure: "upload failed",
    })
  })
})
