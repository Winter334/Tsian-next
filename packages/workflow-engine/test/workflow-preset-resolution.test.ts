/**
 * Workflow preset resource resolution static proof.
 *
 * platform-host owns browser IndexedDB resource loading, while workflow-engine is
 * a pure package. Keep this as a static boundary test instead of importing the
 * browser host into the engine package.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPO_ROOT = resolve(__dirname, '../../..')
const PLATFORM_HOST_FILE = resolve(
  REPO_ROOT,
  'apps/platform-web/src/platform-host/index.ts',
)
const CONTRACT_MOD_FILE = resolve(REPO_ROOT, 'packages/contracts/src/mod.ts')
const RESOURCE_STORAGE_FILE = resolve(
  REPO_ROOT,
  'apps/platform-web/src/storage/resources.ts',
)

describe('workflow preset resource resolution static proof', () => {
  it('ModManifest exposes workflowPresetId as the preferred workflow reference', () => {
    const src = readFileSync(CONTRACT_MOD_FILE, 'utf-8')
    expect(src).toMatch(/workflowPresetId\?:\s*string/)
    expect(src).toMatch(/@deprecated\s+改用 workflowPresetId/)
  })

  it('platform-host resolves workflowPresetId through resource storage before legacy manifest.workflow', () => {
    const src = readFileSync(PLATFORM_HOST_FILE, 'utf-8')

    expect(src).toMatch(
      /import\s*\{[^}]*\bgetWorkflowPresetResource\b[^}]*\}\s*from\s*["']\.\.\/storage\/resources["']/,
    )

    const resolverStart = src.indexOf('async function resolveWorkflowForMod')
    const resolverEnd = src.indexOf('export const playFrontendBridge')
    expect(resolverStart, 'resolveWorkflowForMod should exist').toBeGreaterThanOrEqual(0)
    expect(resolverEnd, 'playFrontendBridge should follow resolver').toBeGreaterThan(resolverStart)
    const resolver = src.slice(resolverStart, resolverEnd)

    expect(resolver).toMatch(/manifest\.workflowPresetId/)
    expect(resolver).toMatch(/getWorkflowPresetResource\s*\(\s*workflowPresetId\s*\)/)
    expect(resolver).toMatch(/references missing workflow preset/)
    expect(resolver).toMatch(/isModWorkflow:\s*true/)

    const workflowPresetIndex = resolver.indexOf('workflowPresetId')
    const legacyWorkflowIndex = resolver.indexOf('manifest.workflow')
    expect(workflowPresetIndex).toBeGreaterThanOrEqual(0)
    expect(legacyWorkflowIndex).toBeGreaterThan(workflowPresetIndex)
  })

  it('builtin workflow preset seeding uses explicit seeds instead of deprecated manifest.workflow', () => {
    const src = readFileSync(RESOURCE_STORAGE_FILE, 'utf-8')

    expect(src).toMatch(/builtinWorkflowPresetSeeds/)

    const seedStart = src.indexOf('export async function seedBuiltinModWorkflowPresetResources')
    const seedEnd = src.indexOf('export async function seedBuiltinResourceLibraryResources')
    expect(seedStart, 'seedBuiltinModWorkflowPresetResources should exist').toBeGreaterThanOrEqual(0)
    expect(seedEnd, 'seedBuiltinResourceLibraryResources should follow workflow seed').toBeGreaterThan(seedStart)
    const seedBody = src.slice(seedStart, seedEnd)

    expect(seedBody).toMatch(/for\s*\(\s*const\s+seed\s+of\s+builtinWorkflowPresetSeeds\s*\)/)
    expect(seedBody).not.toContain('manifest.workflow')
  })

  it('sendMessage awaits save-level workflow metadata, compiles runtime workflow, passes isModWorkflow into executeWorkflow, and carries source into debug trace', () => {
    const src = readFileSync(PLATFORM_HOST_FILE, 'utf-8')

    expect(src).toMatch(
      /const\s+\{\s*def,\s*isModWorkflow,\s*source\s*\}\s*=\s*await\s+resolveWorkflowForSave\(\s*activeSaveId\s*\)/,
    )
    expect(src).toMatch(/const\s+runtimeDef\s*=\s*compileWorkflowStateModel\(\s*def\s*\)/)
    expect(src).toMatch(/createOutputsStore\s*\(\s*\{[\s\S]*source,/)
    expect(src).toMatch(/executeWorkflow\s*\(\s*runtimeDef,\s*wfContext,\s*\{[\s\S]*isModWorkflow/)
  })

  it('platform-host no longer applies mod patch outputs outside explicit workflow nodes', () => {
    const src = readFileSync(PLATFORM_HOST_FILE, 'utf-8')

    expect(src).not.toContain('findHostManagedWorkflowPatch')
    expect(src).not.toContain('hostManagedPatch')
  })

  it('save-level workflow override resolves before mod-level workflow sources', () => {
    const src = readFileSync(PLATFORM_HOST_FILE, 'utf-8')

    const resolverStart = src.indexOf('async function resolveWorkflowForSave')
    const resolverEnd = src.indexOf('export const runtimeEngine')
    expect(resolverStart, 'resolveWorkflowForSave should exist').toBeGreaterThanOrEqual(0)
    expect(resolverEnd, 'runtimeEngine should follow save resolver').toBeGreaterThan(resolverStart)
    const resolver = src.slice(resolverStart, resolverEnd)

    expect(resolver).toMatch(/getWorkflowPresetIdForSave\(saveId\)/)
    expect(resolver).toMatch(/getWorkflowPresetResource\s*\(\s*workflowPresetId\s*\)/)
    expect(resolver).toMatch(/save "\$\{saveId\}" references missing workflow preset/)
    expect(resolver).toMatch(/kind:\s*"save-override"/)
    expect(resolver).toMatch(/isModWorkflow:\s*false/)
    expect(resolver).toMatch(/return\s+resolveWorkflowForMod\(modId\)/)

    const savePresetIndex = resolver.indexOf('getWorkflowPresetIdForSave')
    const modFallbackIndex = resolver.indexOf('resolveWorkflowForMod')
    expect(savePresetIndex).toBeGreaterThanOrEqual(0)
    expect(modFallbackIndex).toBeGreaterThan(savePresetIndex)
  })
})
