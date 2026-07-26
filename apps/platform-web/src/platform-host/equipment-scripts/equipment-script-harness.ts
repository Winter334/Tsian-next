import type { JsonValue, WorkspaceFile } from "@tsian/contracts"
import { parse } from "@babel/parser"
import { createRuntimeWorkspaceTransaction } from "@/storage/workspace"
import { createDefaultWorkspaceTemplateFiles } from "@/storage/workspace"
import { executeWorkspaceOperation } from "@/agent-runtime/workspace-operations"
import { parseActionDeclarations, resolveBrowserScriptPath, resolveHelperPath } from "@/agent-runtime/workspace-tools"
import { buildSkillRegistry } from "@/agent-runtime/registry"
import { validateStrictJson } from "../frontend-actions/json"
import { resolveFrontendAction } from "../frontend-actions/registry"
import { validateAndInlineFrontendActionImports } from "../frontend-actions/imports"

export type EquipmentDistribution = "internal" | "formal"
export type EquipmentTarget = "action-preview" | "action-commit" | "skill"

interface FixtureJsonContent { encoding: "json"; value: JsonValue }
interface FixtureTextContent { encoding: "text"; value: string }
type FixtureContent = FixtureJsonContent | FixtureTextContent

export interface EquipmentFixtureCase {
  id: string
  suite: "shared-mutation" | "skill-refresh"
  operation: "equip" | "unequip" | "refresh"
  input: Record<string, JsonValue>
  workspace: Array<{ scope: "card-content" | "save-runtime"; path: string; content: FixtureContent }>
  expected:
    | { ok: true; output: JsonValue; stateChanges: Array<{ path: string; content: FixtureContent }> }
    | { ok: false; error: { code: string; details?: JsonValue }; stateChanges: [] }
}

export interface EquipmentFixtureDocument {
  schemaVersion: 1
  cases: EquipmentFixtureCase[]
}

export interface EquipmentExecutionOptions {
  signal?: { aborted: boolean; throwIfAborted(): void }
  sdkFault?: { operation: "workspace.read" | "workspace.list" | "workspace.write"; error: unknown }
}

export interface EquipmentExecutionResult {
  ok: boolean
  output?: JsonValue
  error?: { code: string; details?: JsonValue }
  stateChanges: Array<{ path: string; content: string }>
}

const FORMAL_WORKSPACE_MODULES = import.meta.glob(
  "../../../../../cards/沉浸阅读器.tsian-card/workspace/**/*",
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...args: string[]) => (...values: unknown[]) => Promise<unknown>

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function strictJson(value: unknown): value is JsonValue {
  return validateStrictJson(value).ok
}

function assertFixture(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid equipment fixture: ${message}`)
}

function validPath(path: unknown): path is string {
  return typeof path === "string"
    && path.length > 0
    && path === path.trim()
    && !path.includes("\\")
    && !path.startsWith("/")
    && path.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
}

export function validateFixtureDocument(value: unknown): asserts value is EquipmentFixtureDocument {
  assertFixture(isRecord(value) && value.schemaVersion === 1 && Array.isArray(value.cases), "root shape")
  const ids = new Set<string>()
  for (const fixture of value.cases) {
    assertFixture(isRecord(fixture), "case object")
    assertFixture(typeof fixture.id === "string" && fixture.id.length > 0 && !ids.has(fixture.id), "unique case id")
    ids.add(fixture.id)
    assertFixture(fixture.suite === "shared-mutation" || fixture.suite === "skill-refresh", `${fixture.id} suite`)
    assertFixture(fixture.operation === "equip" || fixture.operation === "unequip" || fixture.operation === "refresh", `${fixture.id} operation`)
    assertFixture(
      (fixture.suite === "shared-mutation" && fixture.operation !== "refresh")
        || (fixture.suite === "skill-refresh" && fixture.operation === "refresh"),
      `${fixture.id} suite/operation consistency`,
    )
    assertFixture(isRecord(fixture.input) && strictJson(fixture.input), `${fixture.id} input`)
    assertFixture(Array.isArray(fixture.workspace), `${fixture.id} workspace`)
    const paths = new Set<string>()
    for (const file of fixture.workspace) {
      assertFixture(isRecord(file) && (file.scope === "card-content" || file.scope === "save-runtime"), `${fixture.id} file scope`)
      assertFixture(validPath(file.path) && !paths.has(file.path), `${fixture.id} normalized unique path`)
      paths.add(file.path)
      assertFixture(isRecord(file.content), `${fixture.id} file content`)
      assertFixture(
        (file.content.encoding === "text" && typeof file.content.value === "string")
          || (file.content.encoding === "json" && strictJson(file.content.value)),
        `${fixture.id} file encoding`,
      )
    }
    assertFixture(isRecord(fixture.expected) && typeof fixture.expected.ok === "boolean", `${fixture.id} expected`)
    if (fixture.expected.ok) {
      assertFixture(strictJson(fixture.expected.output) && Array.isArray(fixture.expected.stateChanges), `${fixture.id} success`)
      const changedPaths = new Set<string>()
      for (const change of fixture.expected.stateChanges) {
        assertFixture(isRecord(change), `${fixture.id} state change`)
        assertFixture(validPath(change.path) && !changedPaths.has(change.path), `${fixture.id} normalized unique state change path`)
        changedPaths.add(change.path)
        assertFixture(isRecord(change.content), `${fixture.id} state change content`)
        assertFixture(
          (change.content.encoding === "text" && typeof change.content.value === "string")
            || (change.content.encoding === "json" && strictJson(change.content.value)),
          `${fixture.id} state change encoding`,
        )
      }
    } else {
      assertFixture(isRecord(fixture.expected.error) && typeof fixture.expected.error.code === "string" && fixture.expected.error.code.length > 0, `${fixture.id} error`)
      assertFixture(fixture.expected.error.details === undefined || strictJson(fixture.expected.error.details), `${fixture.id} error details`)
      assertFixture(Array.isArray(fixture.expected.stateChanges) && fixture.expected.stateChanges.length === 0, `${fixture.id} failure writes`)
    }
  }
}

function encodeContent(content: FixtureContent): string {
  return content.encoding === "text" ? content.value : `${JSON.stringify(content.value, null, 2)}\n`
}

function file(path: string, content: string): WorkspaceFile {
  return { path, content, createdAt: 1, updatedAt: 1 }
}

function formalWorkspaceFiles(): WorkspaceFile[] {
  const marker = "/cards/沉浸阅读器.tsian-card/workspace/"
  return Object.entries(FORMAL_WORKSPACE_MODULES)
    .map(([modulePath, content]) => {
      const normalized = modulePath.replace(/\\/g, "/")
      const markerIndex = normalized.indexOf(marker)
      if (markerIndex < 0) throw new Error(`Formal workspace module path is invalid: ${modulePath}`)
      return file(normalized.slice(markerIndex + marker.length), content)
    })
    .sort((left, right) => left.path.localeCompare(right.path))
}

export async function distributionFiles(distribution: EquipmentDistribution): Promise<WorkspaceFile[]> {
  if (distribution === "formal") return formalWorkspaceFiles()
  return createDefaultWorkspaceTemplateFiles().map((entry) => file(entry.path, entry.content ?? ""))
}

function compileFunctionBody(source: string): (...args: unknown[]) => Promise<unknown> {
  parse(source, {
    sourceType: "script",
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
  })
  return new AsyncFunction("input", "tsian", "signal", "importScripts", `"use strict";\n${source}`)
}

function actionCoreError(value: unknown): never {
  throw { actionDomainFailure: true, value }
}

async function workspaceSdk(transaction: ReturnType<typeof createRuntimeWorkspaceTransaction>, operation: string, args: unknown): Promise<unknown> {
  if (!isRecord(args)) throw new Error("Workspace SDK arguments must be an object.")
  try {
    return await executeWorkspaceOperation({ ...args, operation: operation.slice("workspace.".length) } as never, {
      workspaceFiles: transaction.workspaceFiles,
      actorLevel: 1,
      exposedOperations: ["read", "list", "glob", "write", "delete"],
      mutations: {
        write: (input) => transaction.write({ path: input.path, content: input.content }),
        delete: (input) => ({ scope: input.scope, deletedPaths: transaction.delete(input.path).deletedPaths }),
      },
      fileFilter: (candidate) => !candidate.path.startsWith("frontend-actions/"),
    })
  } catch (error) {
    if (operation === "workspace.read" && isRecord(error) && error.code === "WORKSPACE_FILE_NOT_FOUND") return null
    throw error
  }
}

function makeTsian(
  transaction: ReturnType<typeof createRuntimeWorkspaceTransaction>,
  actionMode: boolean,
  sdkFault?: EquipmentExecutionOptions["sdkFault"],
) {
  const invoke = (operation: "workspace.read" | "workspace.list" | "workspace.write" | "workspace.delete" | "workspace.glob") =>
    (args: unknown) => {
      if (sdkFault?.operation === operation) throw sdkFault.error
      return workspaceSdk(transaction, operation, args)
    }
  return {
    workspace: {
      read: invoke("workspace.read"),
      list: invoke("workspace.list"),
      glob: invoke("workspace.glob"),
      write: invoke("workspace.write"),
      delete: invoke("workspace.delete"),
    },
    ...(actionMode ? { action: { fail: actionCoreError } } : {}),
  }
}

function normalizeError(error: unknown, target: EquipmentTarget): { code: string; details?: JsonValue } {
  const value = target.startsWith("action") && isRecord(error) && error.actionDomainFailure === true
    ? error.value
    : error
  const isBusinessFailure = target.startsWith("action")
    ? isRecord(error) && error.actionDomainFailure === true
    : isRecord(value) && value.__equipmentBusinessFailure === true
  if (isBusinessFailure && isRecord(value) && typeof value.code === "string" && value.code.startsWith("EQUIPMENT_")) {
    const normalized: { code: string; details?: JsonValue } = { code: value.code }
    if (strictJson(value.details)) normalized.details = value.details
    return normalized
  }
  throw error
}

function changedFiles(transaction: ReturnType<typeof createRuntimeWorkspaceTransaction>) {
  return transaction.finalWorkspaceChanges().writtenFiles.map((entry) => ({ path: entry.path, content: entry.content }))
}

function fixtureWorkspace(fixture: EquipmentFixtureCase): WorkspaceFile[] {
  return fixture.workspace.map((entry) => file(entry.path, encodeContent(entry.content)))
}

async function runAction(
  files: WorkspaceFile[],
  fixture: EquipmentFixtureCase,
  target: "action-preview" | "action-commit",
  transaction: ReturnType<typeof createRuntimeWorkspaceTransaction>,
  options: EquipmentExecutionOptions,
): Promise<JsonValue> {
  const resolved = resolveFrontendAction({ gameCardId: "equipment-test", actionId: "equipment", files })
  const source = validateAndInlineFrontendActionImports(resolved).source
  const input = { ...fixture.input, mode: target === "action-preview" ? "preview" : "commit", operation: fixture.operation }
  const inputValidation = resolved.inputValidator.validate(input as JsonValue)
  if (!inputValidation.ok) throw new Error(`Action fixture input did not validate: ${fixture.id}`)
  const output = await compileFunctionBody(source)(
    input,
    makeTsian(transaction, true, options.sdkFault),
    options.signal ?? { aborted: false, throwIfAborted() {} },
    () => {},
  )
  if (!strictJson(output)) throw new Error("Action output is not strict JSON.")
  const outputValidation = resolved.outputValidator.validate(output)
  if (!outputValidation.ok) throw new Error(`Action fixture output did not validate: ${fixture.id}`)
  return output
}

async function runSkill(
  files: WorkspaceFile[],
  fixture: EquipmentFixtureCase,
  transaction: ReturnType<typeof createRuntimeWorkspaceTransaction>,
  options: EquipmentExecutionOptions,
): Promise<JsonValue> {
  const skillPath = "agents/stage-manager/skills/装备管理/SKILL.md"
  const skill = buildSkillRegistry(files, { agentId: "stage-manager" }).find((entry) => entry.path === skillPath)
  if (!skill) throw new Error("Equipment Skill is missing from the production registry.")
  const skillFile = files.find((entry) => entry.path === skillPath)
  if (!skillFile) throw new Error("Equipment Skill declaration is missing.")
  const declarations = parseActionDeclarations(skillFile.content)
  if (declarations.errors.length > 0) throw new Error(declarations.errors[0]?.message)
  const action = declarations.actions.find((entry) => entry.name === fixture.operation)
  if (!action) throw new Error(`Equipment Skill action is missing: ${fixture.operation}`)
  const scriptPath = resolveBrowserScriptPath(skill, action.executor)
  const script = files.find((entry) => entry.path === scriptPath)
  if (!script) throw new Error(`Equipment Skill script is missing: ${scriptPath}`)
  const helperSources = (action.executor.helpers ?? []).map((helper) => {
    const helperPath = resolveHelperPath(skillPath, skill.name, helper)
    const helperFile = files.find((entry) => entry.path === helperPath)
    if (!helperFile) throw new Error(`Equipment Skill helper is missing: ${helperPath}`)
    return helperFile.content
  })
  const output = await compileFunctionBody(`${helperSources.join("\n")}\n${script.content}`)(
    fixture.input,
    makeTsian(transaction, false, options.sdkFault),
    options.signal ?? { aborted: false, throwIfAborted() {} },
    () => {},
  )
  if (!strictJson(output)) throw new Error("Skill output is not strict JSON.")
  return output
}

export async function executeEquipmentFixture(
  distribution: EquipmentDistribution,
  target: EquipmentTarget,
  fixture: EquipmentFixtureCase,
  options: EquipmentExecutionOptions = {},
): Promise<EquipmentExecutionResult> {
  const resources = await distributionFiles(distribution)
  const transaction = createRuntimeWorkspaceTransaction([...resources, ...fixtureWorkspace(fixture)])
  try {
    const output = target === "skill"
      ? await runSkill(resources, fixture, transaction, options)
      : await runAction(resources, fixture, target, transaction, options)
    const normalized = target.startsWith("action") && isRecord(output)
      ? Object.fromEntries(Object.entries(output).filter(([key]) => key !== "mode")) as JsonValue
      : output
    return { ok: true, output: normalized, stateChanges: changedFiles(transaction) }
  } catch (error) {
    return { ok: false, error: normalizeError(error, target), stateChanges: changedFiles(transaction) }
  }
}
