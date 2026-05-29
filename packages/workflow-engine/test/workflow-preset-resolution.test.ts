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

  it('sendMessage awaits resolved workflow metadata and passes isModWorkflow into executeWorkflow', () => {
    const src = readFileSync(PLATFORM_HOST_FILE, 'utf-8')

    expect(src).toMatch(
      /const\s+\{\s*def,\s*isModWorkflow\s*\}\s*=\s*await\s+resolveWorkflowForMod/,
    )
    expect(src).toMatch(/executeWorkflow\s*\(\s*def,\s*wfContext,\s*\{[\s\S]*isModWorkflow/)
  })
})
