/**
 * Generic AIRP retrieval structure static proof.
 *
 * platform-web does not yet have a dedicated retrieval test harness. Keep this
 * proof here so the default AIRP retrieval path stays decomposed into internal
 * stage helpers while the public workflow graph still uses one high-level
 * memory-query node.
 */

import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const REPO_ROOT = resolve(__dirname, "../../..")

const RETRIEVAL_FILE = resolve(
  REPO_ROOT,
  "apps/platform-web/src/runtime-host/retrieval.ts",
)

describe("generic AIRP retrieval structure", () => {
  it("keeps assembleRetrievalContext routed through named internal stages", () => {
    const src = readFileSync(RETRIEVAL_FILE, "utf-8")

    expect(src).toContain("interface QueryStageResult")
    expect(src).toContain("interface ExtractionStageResult")
    expect(src).toContain("interface RelationStageResult")
    expect(src).toContain("interface RankingStageResult")
    expect(src).toContain("interface SemanticStageResult")
    expect(src).toContain("interface MergeStageResult")
    expect(src).toContain("function runQueryStage(")
    expect(src).toContain("function runExtractionStage(")
    expect(src).toContain("function runRelationStage(")
    expect(src).toContain("function runRankingStage(")
    expect(src).toContain("async function runSemanticStage(")
    expect(src).toContain("function runMergeStage(")
    expect(src).toContain("function composeRetrievalAssembly(")

    const start = src.indexOf("export async function assembleRetrievalContext")
    expect(start, "assembleRetrievalContext should exist").toBeGreaterThanOrEqual(0)
    const body = src.slice(start)

    const queryIndex = body.indexOf("runQueryStage(")
    const extractionIndex = body.indexOf("runExtractionStage(")
    const relationIndex = body.indexOf("runRelationStage(")
    const rankingIndex = body.indexOf("runRankingStage(")
    const semanticIndex = body.indexOf("runSemanticStage(")
    const mergeIndex = body.indexOf("runMergeStage(")
    const composeIndex = body.indexOf("composeRetrievalAssembly(")

    expect(queryIndex).toBeGreaterThanOrEqual(0)
    expect(extractionIndex).toBeGreaterThan(queryIndex)
    expect(relationIndex).toBeGreaterThan(extractionIndex)
    expect(rankingIndex).toBeGreaterThan(relationIndex)
    expect(semanticIndex).toBeGreaterThan(rankingIndex)
    expect(mergeIndex).toBeGreaterThan(semanticIndex)
    expect(composeIndex).toBeGreaterThan(mergeIndex)
  })
})
