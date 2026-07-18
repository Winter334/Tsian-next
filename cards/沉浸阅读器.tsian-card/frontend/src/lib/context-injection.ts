/**
 * lib/context-injection.ts — 发送前基于 runtime.json 派生的多条 storyteller injection message。
 *
 * 对齐：`.trellis/tasks/07-04-runtime-summary-injection/design.md`。
 *
 * 纯函数、无 vue 依赖：入参 `workspace.read` + `runtime` 快照，出参 3 类 block 的
 * `InjectionMessage[]` 或阻断态。UI 层（useTsian.send）决定阻断时是否推 StreamItem。
 *
 * 边界（design §2）：
 * - 不引入新协议、新持久化文件；injection 是发送前的临时派生上下文。
 * - 不递归展开 scene.present、character.containers 指向的实体。
 * - 不改 runtime/entity/scene 数据（全流程只调 workspace.read）。
 */
import type { InjectionMessage } from "@tsian/contracts"
import type { Runtime, RuntimeData } from "./runtime-types"

// ── 契约类型（design §6） ─────────────────────────────────────────

export interface BuildInjectionInput {
  workspace: {
    read: (
      path: string,
      scope: "save-runtime",
    ) => Promise<{ content: string } | null>
  }
  runtimeData: RuntimeData
}

export type BuildInjectionBlockedReason =
  | "runtime-not-ready"
  | "scene-load-failed"
  | "protagonist-load-failed"

export interface BuildInjectionOk {
  status: "ok"
  messages: InjectionMessage[]
}

export interface BuildInjectionBlocked {
  status: "blocked"
  reason: BuildInjectionBlockedReason
  detail?: string
}

export type BuildInjectionResult = BuildInjectionOk | BuildInjectionBlocked

// ── 内部小工具 ─────────────────────────────────────────────────────

/** ref 形如 `scene:<localId>` / `character:<localId>`；截去 prefix 得 localId。 */
function refToLocalId(ref: string, prefix: "scene:" | "character:"): string {
  return ref.startsWith(prefix) ? ref.slice(prefix.length) : ref
}

/** 空/纯空白字符串 → 默认占位。 */
function orDefault(v: unknown, fallback: string): string {
  if (typeof v === "string" && v.trim()) return v
  if (typeof v === "number") return String(v)
  return fallback
}

/** 从任意 JSON 值取字符串字段；否则返回 undefined。 */
function getString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key]
  return typeof v === "string" && v.trim() ? v : undefined
}

/** 从任意 JSON 值取数字字段；否则返回 undefined。 */
function getNumber(obj: Record<string, unknown>, key: string): number | undefined {
  const v = obj[key]
  return typeof v === "number" && Number.isFinite(v) ? v : undefined
}

/** 任意 JSON 值是否为非数组对象。 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

// ── formatter（design §7） ────────────────────────────────────────

/**
 * runtime/world block（design §7.1）。必发。
 */
export function formatRuntimeBlock(runtime: Runtime): string {
  const lines: string[] = []
  lines.push("【当前上下文·世界】")
  lines.push(`- 回合：${runtime.turn}`)
  lines.push(`- 剧情时间：${orDefault(runtime.worldTime, "未知")}`)
  lines.push(`- 天气/环境：${orDefault(runtime.weather, "未知")}`)
  if (runtime.location && runtime.location.ref) {
    const name = runtime.location.name || "(未命名)"
    lines.push(`- 地点：${name}（ref: ${runtime.location.ref}）`)
  } else {
    lines.push("- 地点：未指定")
  }
  if (runtime.activeSceneRefs.length > 0) {
    lines.push("- 活跃场景：")
    for (const s of runtime.activeSceneRefs) {
      const name = s.name || "(未命名)"
      lines.push(`  · ${s.ref} ${name}`)
    }
  } else {
    lines.push("- 活跃场景：未指定")
  }
  if (runtime.protagonistRef && runtime.protagonistRef.ref) {
    const name = runtime.protagonistRef.name || "(未命名)"
    lines.push(`- 当前视角角色：${name}（ref: ${runtime.protagonistRef.ref}）`)
  } else {
    lines.push("- 当前视角角色：未指定")
  }
  return lines.join("\n")
}

/**
 * active scene block（design §7.2）。每个 activeSceneRef 一条。
 * 只展开一层场景文件，不递归 present[*].ref。
 */
export function formatSceneBlock(
  sceneJson: Record<string, unknown>,
  sceneRef: string,
): string {
  const name = getString(sceneJson, "name") ?? "(未命名场景)"
  const status = getString(sceneJson, "status")
  const brief = getString(sceneJson, "brief")

  const lines: string[] = []
  lines.push(`【当前场景】${name}（ref: ${sceneRef}）`)
  lines.push(`- 状态：${status ?? "未知"}`)

  // location：优先 scene.location.ref；否则 scene.location 若是字符串直接输出
  const loc = sceneJson["location"]
  if (loc && typeof loc === "object" && !Array.isArray(loc)) {
    const locRef = getString(loc as Record<string, unknown>, "ref")
    lines.push(`- 地点：${locRef ?? "未指定"}`)
  } else if (typeof loc === "string" && loc.trim()) {
    lines.push(`- 地点：${loc}`)
  } else {
    lines.push("- 地点：未指定")
  }

  lines.push(`- 简介：${brief ?? "(略)"}`)

  const present = sceneJson["present"]
  if (Array.isArray(present) && present.length > 0) {
    lines.push("- 在场者：")
    for (const p of present) {
      if (p && typeof p === "object") {
        const ref = getString(p as Record<string, unknown>, "ref")
        if (ref) {
          lines.push(`  · ${ref}`)
          continue
        }
      }
      if (typeof p === "string" && p.trim()) {
        lines.push(`  · ${p}`)
      }
    }
  } else {
    lines.push("- 在场者：无")
  }

  return lines.join("\n")
}

/**
 * protagonist block（design §7.3）。character entity 权威字段。
 */
export function formatProtagonistBlock(
  characterJson: Record<string, unknown>,
  characterRef: string,
): string {
  const name = getString(characterJson, "name") ?? "(未命名角色)"
  const brief = getString(characterJson, "brief")

  const lines: string[] = []
  lines.push(`【当前视角角色】${name}（ref: ${characterRef}）`)
  lines.push(`- 简述：${brief ?? "(略)"}`)

  // identity：age/gender/role/affiliation/realm，任一存在即输出一行；缺省字段跳过
  const identity = characterJson["identity"]
  if (identity && typeof identity === "object" && !Array.isArray(identity)) {
    const id = identity as Record<string, unknown>
    const parts: string[] = []
    const age = id["age"]
    if (age !== undefined && age !== null && String(age).trim()) {
      parts.push(`年龄 ${age}`)
    }
    const gender = getString(id, "gender")
    if (gender) parts.push(`性别 ${gender}`)
    const role = getString(id, "role")
    if (role) parts.push(`身份 ${role}`)
    const affiliation = getString(id, "affiliation")
    if (affiliation) parts.push(`组织 ${affiliation}`)
    const realm = getString(id, "realm")
    if (realm) parts.push(`境界 ${realm}`)
    if (parts.length > 0) {
      lines.push(`- 身份：${parts.join(" · ")}`)
    }
  }

  const appearance = getString(characterJson, "appearance")
  if (appearance) {
    lines.push(`- 外貌：${appearance}`)
  }

  // attributes：固定 6 维，键名由世界观定，按 JSON 写入顺序遍历，全缺省则跳过整行
  const attributes = characterJson["attributes"]
  if (attributes && typeof attributes === "object" && !Array.isArray(attributes)) {
    const attr = attributes as Record<string, unknown>
    const parts: string[] = []
    for (const [key, n] of Object.entries(attr)) {
      if (typeof n === "number" && Number.isFinite(n)) parts.push(`${key} ${n}`)
    }
    if (parts.length > 0) {
      lines.push(`- 属性：${parts.join(" · ")}`)
    }
  }

  // gauges：数组，每项 { id, name, value, max?, unit?, tone? }
  const gauges = characterJson["gauges"]
  if (Array.isArray(gauges) && gauges.length > 0) {
    const gaugeLines: string[] = []
    for (const g of gauges) {
      if (!g || typeof g !== "object") continue
      const gObj = g as Record<string, unknown>
      const gName = getString(gObj, "name") ?? getString(gObj, "id")
      const gValue = getNumber(gObj, "value")
      if (!gName || gValue === undefined) continue
      const gMax = getNumber(gObj, "max")
      const gUnit = getString(gObj, "unit")
      const gTone = getString(gObj, "tone")
      let entry = `  · ${gName}: ${gValue}`
      if (gMax !== undefined) entry += `/${gMax}`
      if (gUnit) entry += ` ${gUnit}`
      if (gTone) entry += ` [${gTone}]`
      gaugeLines.push(entry)
    }
    if (gaugeLines.length > 0) {
      lines.push("- 量表：")
      lines.push(...gaugeLines)
    }
  }

  // status：数组，每项 { id, name?, description?, polarity? }
  const status = characterJson["status"]
  if (Array.isArray(status) && status.length > 0) {
    const statusLines: string[] = []
    for (const s of status) {
      if (!s || typeof s !== "object") continue
      const sObj = s as Record<string, unknown>
      const sName = getString(sObj, "name") ?? getString(sObj, "id")
      if (!sName) continue
      const polarity = getString(sObj, "polarity")
      const description = getString(sObj, "description")
      let entry = `  · ${sName}`
      if (polarity) entry += `（${polarity}）`
      if (description) entry += ` — ${description}`
      statusLines.push(entry)
    }
    if (statusLines.length > 0) {
      lines.push("- 状态：")
      lines.push(...statusLines)
    }
  }

  // traits：数组，每项 { id, name?, description?, effects? }（task 07-07 design §6）
  // 永久性稳定特质，注入给 storyteller 让正文反映特质效果。
  const traits = characterJson["traits"]
  if (Array.isArray(traits) && traits.length > 0) {
    const traitLines: string[] = []
    for (const t of traits) {
      if (!isRecord(t)) continue
      const tName = getString(t, "name") ?? getString(t, "id")
      if (!tName) continue
      const description = getString(t, "description")
      let entry = `  · ${tName}`
      if (description) entry += ` — ${description}`
      traitLines.push(entry)
      const effects = t["effects"]
      if (Array.isArray(effects)) {
        for (const e of effects) {
          if (typeof e === "string" && e.trim()) {
            traitLines.push(`    · 效果：${e.trim()}`)
          }
        }
      }
    }
    if (traitLines.length > 0) {
      lines.push("- 特质：")
      lines.push(...traitLines)
    }
  }

  // goals：current/shortTerm/longTerm
  const goals = characterJson["goals"]
  if (goals && typeof goals === "object" && !Array.isArray(goals)) {
    const gObj = goals as Record<string, unknown>
    const goalLines: string[] = []
    const current = getString(gObj, "current")
    if (current) goalLines.push(`  · 当前：${current}`)
    const shortTerm = getString(gObj, "shortTerm")
    if (shortTerm) goalLines.push(`  · 近期：${shortTerm}`)
    const longTerm = getString(gObj, "longTerm")
    if (longTerm) goalLines.push(`  · 长期：${longTerm}`)
    if (goalLines.length > 0) {
      lines.push("- 目标：")
      lines.push(...goalLines)
    }
  }

  return lines.join("\n")
}

// ── 主入口（design §5 / §9） ──────────────────────────────────────

/**
 * 从 runtime.json 派生多条 storyteller injection message。
 *
 * 顺序（design §5 / implement.md Step 3）：
 * 1. kill-switch：`runtime.extensions.frontendInjection.enabled === false` → ok, messages=[]。
 * 2. runtime 未就绪：`status !== "ready" || !runtime` → blocked "runtime-not-ready"。
 * 3. 拼 runtime/world message。
 * 4. 对每个 activeSceneRefs[*]：workspace.read；null/抛错/JSON.parse 失败 → blocked "scene-load-failed"。
 * 5. protagonistRef 若有：workspace.read；错误同上 → blocked "protagonist-load-failed"。
 * 6. 返回 { status: "ok", messages }，每条 role="system", position="before-input"。
 */
export async function buildContextInjection(
  input: BuildInjectionInput,
): Promise<BuildInjectionResult> {
  const { workspace, runtimeData } = input
  const runtime = runtimeData.runtime

  // 1. kill-switch：extensions.frontendInjection.enabled === false
  if (runtime) {
    const ext = runtime.extensions
    const flag = ext && typeof ext === "object"
      ? (ext as Record<string, unknown>)["frontendInjection"]
      : undefined
    if (flag && typeof flag === "object" && !Array.isArray(flag)) {
      const enabled = (flag as Record<string, unknown>)["enabled"]
      if (enabled === false) {
        return { status: "ok", messages: [] }
      }
    }
  }

  // 2. runtime 未就绪
  if (runtimeData.status !== "ready" || !runtime) {
    return { status: "blocked", reason: "runtime-not-ready" }
  }

  const messages: InjectionMessage[] = []

  // 3. runtime/world block（必发）
  messages.push({
    role: "system",
    content: formatRuntimeBlock(runtime),
    position: "before-input",
  })

  // 4. scene blocks：对每个 activeSceneRefs[*] 逐条读取；任一失败即阻断
  for (const sceneEntry of runtime.activeSceneRefs) {
    const ref = sceneEntry.ref
    if (!ref) continue
    const localId = refToLocalId(ref, "scene:")
    const path = `save/scenes/${localId}.json`
    let file: { content: string } | null
    try {
      file = await workspace.read(path, "save-runtime")
    } catch {
      return { status: "blocked", reason: "scene-load-failed", detail: ref }
    }
    if (file === null) {
      return { status: "blocked", reason: "scene-load-failed", detail: ref }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(file.content)
    } catch {
      return { status: "blocked", reason: "scene-load-failed", detail: ref }
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { status: "blocked", reason: "scene-load-failed", detail: ref }
    }
    messages.push({
      role: "system",
      content: formatSceneBlock(parsed as Record<string, unknown>, ref),
      position: "before-input",
    })
  }

  // 5. protagonist block：若有 protagonistRef
  if (runtime.protagonistRef && runtime.protagonistRef.ref) {
    const ref = runtime.protagonistRef.ref
    const localId = refToLocalId(ref, "character:")
    const path = `save/entities/character/${localId}.json`
    let file: { content: string } | null
    try {
      file = await workspace.read(path, "save-runtime")
    } catch {
      return { status: "blocked", reason: "protagonist-load-failed", detail: ref }
    }
    if (file === null) {
      return { status: "blocked", reason: "protagonist-load-failed", detail: ref }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(file.content)
    } catch {
      return { status: "blocked", reason: "protagonist-load-failed", detail: ref }
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { status: "blocked", reason: "protagonist-load-failed", detail: ref }
    }
    messages.push({
      role: "system",
      content: formatProtagonistBlock(parsed as Record<string, unknown>, ref),
      position: "before-input",
    })
  }

  // 6. ok
  return { status: "ok", messages }
}
