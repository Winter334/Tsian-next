/**
 * Generic AIRP maintenance migration static proof.
 *
 * platform-web owns the browser runtime and prompt preset resources. Keep the
 * proof here as static cross-layer assertions until platform-web has its own
 * test harness.
 */

import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const REPO_ROOT = resolve(__dirname, "../../..")

const PLATFORM_HOST_FILE = resolve(
  REPO_ROOT,
  "apps/platform-web/src/platform-host/index.ts",
)
const MAINTENANCE_PRESET_FILE = resolve(
  REPO_ROOT,
  "apps/platform-web/src/workflow-host/builtin-presets/maintenance.preset.json",
)

describe("generic AIRP maintenance migration", () => {
  it("maintenance preset instructs the model to emit StateWriteOperation JSON", () => {
    const src = readFileSync(MAINTENANCE_PRESET_FILE, "utf-8")

    expect(src).toContain("StateWriteOperation")
    expect(src).toContain("固定输出形状：{\\\"operations\\\":[...]}。")
    expect(src).toContain("每个 operation 默认写入 AIRP 内置命名空间")
    expect(src).toContain("currentTime 是保留的 globals 记录")
    expect(src).toContain("不要输出旧 patch 格式里的 currentTime / globals / events / archives 顶层对象")
  })

  it("platform-host loads generic AIRP memory before execution and syncs compatibility state after the turn", () => {
    const src = readFileSync(PLATFORM_HOST_FILE, "utf-8")

    expect(src).toMatch(
      /import\s*\{[\s\S]*loadAirpMemoryProjectionForSave[\s\S]*syncAirpCompatibilityStateForSave[\s\S]*\}\s*from\s*["']\.\.\/storage["']/,
    )

    const sendMessageStart = src.indexOf("async sendMessage(input)")
    const sendMessageEnd = src.indexOf("  debug: createDebugBridge")
    expect(sendMessageStart, "sendMessage should exist").toBeGreaterThanOrEqual(0)
    expect(sendMessageEnd, "debug bridge block should follow interaction.sendMessage").toBeGreaterThan(sendMessageStart)
    const sendMessageBody = src.slice(sendMessageStart, sendMessageEnd)

    expect(sendMessageBody).toMatch(
      /const\s+airpMemory\s*=\s*await\s+loadAirpMemoryProjectionForSave\(activeSaveId\)/,
    )
    expect(sendMessageBody).toMatch(
      /const\s+currentTime\s*=\s*airpMemory\.currentTime\s*\?\?\s*getSnapshotCurrentTime\(currentSnapshot\)/,
    )
    expect(sendMessageBody).toMatch(
      /const\s+persisted\s*=\s*await\s+syncAirpCompatibilityStateForSave\(\s*activeSaveId,\s*snapshotAfter,\s*\)/,
    )
    expect(sendMessageBody).toMatch(
      /await\s+createCheckpointForSave\(\s*activeSaveId,\s*\{[\s\S]*stateRecords:\s*await\s+listLocalStateRecordsForSave\(activeSaveId\),[\s\S]*reason:\s*"after-turn"/,
    )

    const loadIndex = sendMessageBody.indexOf("loadAirpMemoryProjectionForSave(activeSaveId)")
    const syncIndex = sendMessageBody.indexOf("syncAirpCompatibilityStateForSave(")
    expect(loadIndex).toBeGreaterThanOrEqual(0)
    expect(syncIndex).toBeGreaterThan(loadIndex)
  })
})
