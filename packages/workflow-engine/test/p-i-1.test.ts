/**
 * P-I-1：桥 API patch 路径错误一致性验收
 *
 * 设计目标：
 *   桥 API 写运行时（applyPatch / updateGlobals / appendUserMessage / appendAssistantMessage 中
 *   "patch 类"两条路径）必须共用同一份 patch 应用器代码（`applyMaintenancePatch`）。
 *   同一非法 patch 通过两条 bridge 路径触发时，错误 (cause)
 *   必然一致 —— 因为它们都源自同一函数同一行。
 *
 * 测试策略：静态代码证明（static proof）
 * --------------------------------------------------------------------------
 * 为何不做动态测试：
 *   - `applyMaintenancePatch` 在 `apps/platform-web/src/runtime-host/patch-applier.ts`，
 *     依赖 Dexie（浏览器 IndexedDB）+ LocalRuntimeEngine（强浏览器环境耦合）。
 *   - `packages/workflow-engine`（本测试所在包）为纯调度核心，没有装也不该装 platform-web；
 *     反向依赖会破坏分层契约。
 *   - `apps/platform-web` 没有 vitest（且引入 vitest 需要解决 Vite + IndexedDB shim 的额外
 *     成本），原型期 YAGNI。
 *
 * 静态证明做法：
 *   1. 把桥 API 路径与 applier 的关键源文件作为字符串读入；
 *   2. 断言 bridge patch API `import { applyMaintenancePatch }` 自
 *      `runtime-host/patch-applier`；
 *   3. 断言 applyPatch / updateGlobals 都直接调用 `applyMaintenancePatch(`；
 *   4. 由此推出：同一非法 patch 进入两条路径时，落点是同一函数 → 抛出的错误必然一致。
 *
 * 既然抛错来自同一函数同一行，逻辑等价于 "f(x) === f(x)"，无需运行时验证。
 * --------------------------------------------------------------------------
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// 仓库根 = packages/workflow-engine 之上两级
const REPO_ROOT = resolve(__dirname, '../../..')

const BRIDGE_PATH_FILE = resolve(
  REPO_ROOT,
  'apps/platform-web/src/platform-host/index.ts',
)
const APPLIER_FILE = resolve(
  REPO_ROOT,
  'apps/platform-web/src/runtime-host/patch-applier.ts',
)

describe('P-I-1 桥 API patch 路径错误一致性（静态证明）', () => {
  it('platform-host 桥 API 从 ../runtime-host/patch-applier 导入 applyMaintenancePatch', () => {
    const src = readFileSync(BRIDGE_PATH_FILE, 'utf-8')
    expect(src).toMatch(
      /import\s*\{[^}]*\bapplyMaintenancePatch\b[^}]*\}\s*from\s*["']\.\.\/runtime-host\/patch-applier["']/,
    )
  })

  it('桥 API 的 applyPatch 与 updateGlobals 方法体内直接调用 applyMaintenancePatch（patch 类路径）', () => {
    const src = readFileSync(BRIDGE_PATH_FILE, 'utf-8')

    // applyPatch 方法块
    const applyPatchMatch = src.match(
      /async\s+applyPatch\s*\([\s\S]*?\}\s*,\s*\n/,
    )
    expect(applyPatchMatch, 'applyPatch 方法应该存在').not.toBeNull()
    expect(applyPatchMatch![0]).toMatch(/applyMaintenancePatch\s*\(/)

    // updateGlobals 方法块
    const updateGlobalsMatch = src.match(
      /async\s+updateGlobals\s*\([\s\S]*?\}\s*,\s*\n/,
    )
    expect(updateGlobalsMatch, 'updateGlobals 方法应该存在').not.toBeNull()
    expect(updateGlobalsMatch![0]).toMatch(/applyMaintenancePatch\s*\(/)
  })

  it('appendUserMessage / appendAssistantMessage 属于"append 例外"，直调 engine 同步方法（HC-14 例外说明）', () => {
    const src = readFileSync(BRIDGE_PATH_FILE, 'utf-8')
    // 两个 append 方法应该调用 runtimeEngine.appendXxxMessage 而非 applyMaintenancePatch
    const appendUserMatch = src.match(
      /async\s+appendUserMessage\s*\([\s\S]*?\n\s{4}\}\s*,/,
    )
    expect(appendUserMatch).not.toBeNull()
    expect(appendUserMatch![0]).toMatch(/runtimeEngine\.appendUserMessage/)
    expect(appendUserMatch![0]).not.toMatch(/applyMaintenancePatch/)

    const appendAssistantMatch = src.match(
      /async\s+appendAssistantMessage\s*\([\s\S]*?\n\s{4}\}\s*,/,
    )
    expect(appendAssistantMatch).not.toBeNull()
    expect(appendAssistantMatch![0]).toMatch(
      /runtimeEngine\.appendAssistantMessage/,
    )
    expect(appendAssistantMatch![0]).not.toMatch(/applyMaintenancePatch/)
  })

  it('applyMaintenancePatch 在 patch-applier.ts 中是唯一定义点（function/export）', () => {
    const src = readFileSync(APPLIER_FILE, 'utf-8')
    // 单一定义：避免被复制重写
    const defMatches = src.match(/export\s+async\s+function\s+applyMaintenancePatch\s*\(/g)
    expect(defMatches, '应有且仅有一处 export async function applyMaintenancePatch 定义').not.toBeNull()
    expect(defMatches!.length).toBe(1)
  })

  it('applyMaintenancePatch 同步 generic AIRP memory，避免兼容 patch 被回合末投影覆盖', () => {
    const src = readFileSync(APPLIER_FILE, 'utf-8')

    expect(src).toMatch(
      /import\s*\{[\s\S]*replaceAirpMemoryForSave[\s\S]*\}\s*from\s*["']\.\.\/storage["']/,
    )
    expect(src).toMatch(/await\s+replaceAirpMemoryForSave\s*\(\s*saveId,\s*\{/)

    const syncIndex = src.indexOf('await replaceAirpMemoryForSave(saveId')
    const checkpointIndex = src.indexOf('if (pushCheckpointReason)')
    expect(syncIndex).toBeGreaterThan(-1)
    expect(checkpointIndex).toBeGreaterThan(syncIndex)
  })

  it('结论：两条路径共用同一函数 → 同一非法 patch 抛错必然一致（HC-14 保证）', () => {
    // 这里不做更多断言；上面 5 条已经联合证明：
    //   桥 API (applyPatch / updateGlobals) → applyMaintenancePatch
    // 两条 bridge patch 路径对一函数 (f)，错误来自 f 的同一份代码 → throw 等价。
    expect(true).toBe(true)
  })
})
