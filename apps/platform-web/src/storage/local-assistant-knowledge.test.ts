import "fake-indexeddb/auto"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { localDb } from "./db"
import {
  LOCAL_ASSISTANT_DIR,
  loadLocalAssistantFiles,
  refreshLocalAssistantFrameworkKnowledgeFiles,
  saveLocalAssistantFiles,
} from "./local-assistant-files"
import { defaultFrameworkKnowledgeFileMap } from "./local-assistant-knowledge"

const DIAGNOSTICS_REFERENCE_PATH = `${LOCAL_ASSISTANT_DIR}/skills/framework-knowledge/references/diagnostics.md`
const SKILL_PATH = `${LOCAL_ASSISTANT_DIR}/skills/framework-knowledge/SKILL.md`

beforeEach(async () => {
  await localDb.delete()
  await localDb.open()
})

afterEach(async () => {
  await localDb.delete()
})

describe("desktop assistant diagnostics knowledge", () => {
  it("includes task-focused diagnostics guidance in new default knowledge", async () => {
    const defaults = defaultFrameworkKnowledgeFileMap(LOCAL_ASSISTANT_DIR)
    const skill = defaults[SKILL_PATH]?.content ?? ""
    const diagnostics = defaults[DIAGNOSTICS_REFERENCE_PATH]?.content ?? ""

    expect(skill.indexOf("references/diagnostics.md")).toBeGreaterThan(
      skill.indexOf("references/workspace-and-authoring.md"),
    )
    expect(diagnostics).toContain("`.tsian/local/diagnostics/`")
    expect(diagnostics).toContain("`operationId`")
    expect(diagnostics).toContain("后续请求")
    expect(diagnostics).toContain("只读")
    expect(diagnostics).toContain("快照")
    expect(diagnostics).not.toMatch(/IndexedDB|Dexie|adapter|table|actor level/i)

    const installed = await loadLocalAssistantFiles()
    expect(installed.find((file) => file.path === DIAGNOSTICS_REFERENCE_PATH)?.content)
      .toBe(diagnostics)
  })

  it("refreshes the official diagnostics reference without replacing user files", async () => {
    await loadLocalAssistantFiles()
    const agentPath = `${LOCAL_ASSISTANT_DIR}/AGENT.md`
    const customPath = `${LOCAL_ASSISTANT_DIR}/skills/custom/SKILL.md`
    await saveLocalAssistantFiles([
      { path: DIAGNOSTICS_REFERENCE_PATH, content: "stale", createdAt: 1, updatedAt: 1 },
      { path: agentPath, content: "user agent", createdAt: 1, updatedAt: 1 },
      { path: customPath, content: "user skill", createdAt: 1, updatedAt: 1 },
    ])

    const result = await refreshLocalAssistantFrameworkKnowledgeFiles()
    const refreshed = await loadLocalAssistantFiles()
    const defaults = defaultFrameworkKnowledgeFileMap(LOCAL_ASSISTANT_DIR)

    expect(result.updatedPaths).toContain(DIAGNOSTICS_REFERENCE_PATH)
    expect(refreshed.find((file) => file.path === DIAGNOSTICS_REFERENCE_PATH)?.content)
      .toBe(defaults[DIAGNOSTICS_REFERENCE_PATH].content)
    expect(refreshed.find((file) => file.path === agentPath)?.content).toBe("user agent")
    expect(refreshed.find((file) => file.path === customPath)?.content).toBe("user skill")
  })
})
