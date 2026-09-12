import type { WorkspaceFile } from "@tsian/contracts"
import { createRuntimeWorkspaceTransaction } from "../src/storage/workspace"
import { assembleAgentContext } from "../src/agent-runtime/context"
import { deriveAgentRuntimePermissionProfile } from "../src/agent-runtime/permissions"
import { buildEnabledToolSchemas } from "../src/agent-runtime/tool-schemas"
import { createRuntimeWorkspaceToolSessionState } from "../src/agent-runtime/workspace-tools"
import { executeRunScript } from "../src/agent-runtime/workspace-tools/skill-actions"
import { createBrowserSkillScriptRunner } from "../src/platform-host/browser-skill-script-executor"
import { prepareMaintenanceContext, verifyMaintenance } from "../../play-frontend-dev/src/lib/maintenance-context"

/** Deterministic fixtures against the actual imported Skill + real browser Worker.
 * No model or persistent player-save mutations; each case owns a disposable transaction.
 */
export async function verifySemanticMaintenance(resources: WorkspaceFile[]) {
  const skillPath = "agents/stage-manager/skills/回合后维护/SKILL.md"
  const turnPath = "save/history/turns/turn-000002.json"
  const heroPath = "save/entities/character/hero.json"
  const recall = { summary: "诊脉结束，旧伤未愈。", entities: ["character:hero"], events: ["对话交流"], tags: ["诊脉"] }
  const changes = { entities: [{ ref: "character:hero", experiences: ["医师确认旧伤未愈。"] }], recall }
  async function setup(fault?: "write" | "output") {
    const fixture = [
      { path: turnPath, value: { timeline: [{ kind: "user", content: "请医师诊脉" }, { kind: "assistant", content: "诊脉结束，旧伤未愈。" }], meta: {} } },
      { path: "save/schema/world.json", value: { title: "诊脉世界", power: { tiers: [], scale: "gentle" }, dimensions: [
        { name: "力量", kind: "growth", meaning: "体力" }, { name: "身法", kind: "hybrid", meaning: "步法" },
        { name: "悟性", kind: "talent", meaning: "领悟" }, { name: "根骨", kind: "talent", meaning: "资质" },
      ], rules: [] } },
      { path: heroPath, value: { id: "character:hero", name: "患者", brief: "待诊", attributes: {}, status: [{ id: "old", name: "旧伤" }] } },
      { path: "save/playthrough/runtime.json", value: { turn: 2, plotOrder: 3, worldTime: "上午", protagonistRef: { ref: "character:hero" }, activeSceneRefs: [] } },
    ].map(entry => ({ path: entry.path, content: JSON.stringify(entry.value), createdAt: 0, updatedAt: 0 }))
    const source = resources.filter(file => !file.path.startsWith("save/")).map(file => {
      if (fault !== "output" || file.path !== skillPath) return file
      const match = /```json tsian-actions\s*([\s\S]*?)```/.exec(file.content)!
      const actions = JSON.parse(match[1]!)
      actions.find((action: { name: string }) => action.name === "submit_changes").outputSchema = { type: "object", required: ["impossible"] }
      return { ...file, content: file.content.replace(match[1]!, JSON.stringify(actions) + "\n") }
    })
    const tx = createRuntimeWorkspaceTransaction([...source, ...fixture])
    const workspace = {
      read: async (path: string) => tx.workspaceFiles.find(file => file.path === path) ?? null,
      write: async (path: string, content: string) => tx.write({ path, content }),
    } as unknown as Parameters<typeof prepareMaintenanceContext>[0]
    const prepared = await prepareMaintenanceContext(workspace, 2)
    const agentContext = assembleAgentContext(tx.workspaceFiles, { agentId: "stage-manager" })!
    const permissions = deriveAgentRuntimePermissionProfile(agentContext.agent)
    const toolNames = buildEnabledToolSchemas({ disabledToolNames: agentContext.agent.disabledTools, enabledPlatformTools: permissions.enabledTools, allowAgentCall: false, visibleContacts: [], userTools: agentContext.toolIndex }).map(value => value.name)
    if (toolNames.join(",") !== "use_skill,run_script") throw new Error("Imported stage-manager exposes non-semantic tools.")
    let writes = 0
    const runBrowserScript = createBrowserSkillScriptRunner({ workspaceTransaction: {
      workspaceFiles: tx.workspaceFiles,
      createSavepoint: () => tx.createSavepoint(), rollbackToSavepoint: savepoint => tx.rollbackToSavepoint(savepoint),
      delete: path => tx.delete(path),
      write: input => {
        if (fault === "write" && ++writes === 2) throw new Error("Injected mid-write failure")
        return tx.write(input)
      },
    } })
    const context = { workspaceFiles: tx.workspaceFiles, agentContext, exposedWorkspaceOperations: permissions.exposedWorkspaceOperations, workspaceFileFilter: (file: WorkspaceFile) => !file.path.startsWith("frontend-actions/"), runBrowserScript, sessionState: createRuntimeWorkspaceToolSessionState() }
    const run = (input: Record<string, unknown>) => executeRunScript(context, { skill: "回合后维护", script: "submit_changes", input })
    return { tx, run, prepared, workspace, toolNames }
  }
  const valid = await setup()
  await valid.run(changes)
  await verifyMaintenance(valid.workspace, valid.prepared)
  const completedHero = JSON.parse(valid.tx.workspaceFiles.find(file => file.path === heroPath)!.content)
  if (Object.keys(completedHero.attributes).length !== 4 || Object.values(completedHero.attributes).some(value => value !== 5)) throw new Error("Missing character attributes were not filled from ordinary baselines")
  const applied = JSON.stringify(valid.tx.workspaceFiles)
  await valid.run(changes)
  if (JSON.stringify(valid.tx.workspaceFiles) !== applied) throw new Error("Repeated semantic submission is not idempotent.")
  for (const fault of ["write", "output"] as const) {
    const fixture = await setup(fault)
    const before = JSON.stringify(fixture.tx.workspaceFiles)
    let rejected = false
    try { await fixture.run(changes) } catch { rejected = true }
    if (!rejected || JSON.stringify(fixture.tx.workspaceFiles) !== before) throw new Error(`Semantic ${fault} failure did not roll back its savepoint (rejected=${rejected}).`)
  }
  return { realWorker: true, submitted: true, receiptVerified: true, idempotent: true, midWriteRollback: true, outputValidationRollback: true, toolNames: valid.toolNames, liveAiCalls: 0 }
}
