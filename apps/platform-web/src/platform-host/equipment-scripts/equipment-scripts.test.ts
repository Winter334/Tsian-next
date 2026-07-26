import fixtureDocument from "./equipment-cases.json"
import { describe, expect, it } from "vitest"
import {
  distributionFiles,
  executeEquipmentFixture,
  validateFixtureDocument,
  type EquipmentFixtureCase,
} from "./equipment-script-harness"

const rawFixtureDocument: unknown = fixtureDocument
validateFixtureDocument(rawFixtureDocument)
const fixtures = rawFixtureDocument.cases

function expectedChanges(fixture: EquipmentFixtureCase): Array<{ path: string; content: string }> {
  return fixture.expected.stateChanges.map((entry) => ({
    path: entry.path,
    content: entry.content.encoding === "text"
      ? entry.content.value
      : `${JSON.stringify(entry.content.value, null, 2)}\n`,
  }))
}

describe("deterministic equipment distributed scripts", () => {
  it("enforces the production strict JSON subset for fixture values", () => {
    const makeDocument = (candidate: unknown): unknown => ({
      schemaVersion: 1,
      cases: [{
        id: "strict-json-probe",
        suite: "shared-mutation",
        operation: "equip",
        input: { candidate },
        workspace: [],
        expected: { ok: false, error: { code: "EQUIPMENT_DATA_INVALID" }, stateChanges: [] },
      }],
    })
    const expectInvalid = (input: unknown): void => {
      expect(() => validateFixtureDocument(makeDocument(input))).toThrow("Invalid equipment fixture")
    }

    const sparse = new Array(1)
    const accessor = Object.defineProperty({}, "value", { enumerable: true, get: () => true })
    const symbolic = { [Symbol("secret")]: true }
    const hidden = Object.defineProperty({}, "value", { value: true })
    const exotic = new Date()
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle

    for (const input of [sparse, accessor, symbolic, hidden, exotic, cycle]) expectInvalid(input)

    const nullPrototype = Object.create(null) as Record<string, unknown>
    nullPrototype.ok = true
    expect(() => validateFixtureDocument(makeDocument(nullPrototype)))
      .not.toThrow()
  })

  it("keeps internal and formal equipment resources byte-identical", async () => {
    const [internal, formal] = await Promise.all([distributionFiles("internal"), distributionFiles("formal")])
    const prefixes = ["frontend-actions/equipment/", "agents/stage-manager/skills/装备管理/"]
    const select = (files: Awaited<ReturnType<typeof distributionFiles>>) => Object.fromEntries(
      files
        .filter((entry) => prefixes.some((prefix) => entry.path.startsWith(prefix)))
        .map((entry) => [entry.path, entry.content]),
    )
    expect(select(internal)).toEqual(select(formal))
  })

  it("does not normalize aborts or SDK failures into equipment business errors", async () => {
    const fixture = fixtures.find((entry) => entry.id === "equip-empty-one-rounding")
    if (!fixture) throw new Error("Abort/runtime fixture is missing.")

    const abortError = new Error("aborted")
    const signal = {
      aborted: true,
      throwIfAborted(): void {
        throw abortError
      },
    }
    await expect(executeEquipmentFixture("internal", "action-preview", fixture, { signal })).rejects.toBe(abortError)

    for (const target of ["action-preview", "skill"] as const) {
      const sdkError = Object.assign(new Error("sdk failed"), { code: "SDK_READ_FAILED" })
      await expect(executeEquipmentFixture("internal", target, fixture, {
        sdkFault: { operation: "workspace.read", error: sdkError },
      })).rejects.toBe(sdkError)
    }

    for (const target of ["action-commit", "skill"] as const) {
      const writeError = Object.assign(new Error("write failed"), { code: "SDK_WRITE_FAILED" })
      await expect(executeEquipmentFixture("internal", target, fixture, {
        sdkFault: { operation: "workspace.write", error: writeError },
      })).rejects.toBe(writeError)
    }
  })

  for (const fixture of fixtures) {
    const targets = fixture.suite === "shared-mutation"
      ? (["action-preview", "action-commit", "skill"] as const)
      : (["skill"] as const)

    for (const distribution of ["internal", "formal"] as const) {
      for (const target of targets) {
        it(`${fixture.id}: ${distribution} ${target}`, async () => {
          const result = await executeEquipmentFixture(distribution, target, fixture)
          if (fixture.expected.ok) {
            expect(result).toEqual({
              ok: true,
              output: fixture.expected.output,
              stateChanges: target === "action-preview" ? [] : expectedChanges(fixture),
            })
          } else {
            expect(result).toEqual({
              ok: false,
              error: fixture.expected.error,
              stateChanges: [],
            })
          }
        })
      }
    }
  }
})
