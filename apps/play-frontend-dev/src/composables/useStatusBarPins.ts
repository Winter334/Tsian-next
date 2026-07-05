/**
 * composables/useStatusBarPins.ts — 状态栏"钉选"字段偏好持久化（模块级单例）。
 *
 * 对齐：
 * - design.md §7（模块级单例 + localStorage 读写）
 * - design.md §12（读写异常静默兜底）
 * - hook-guidelines "Rules"（副作用显式，命名说明持久化）
 *
 * 同 useStatusBarCollapsed 模式：模块级共享 `pinsRef`，通过 watch 写入 localStorage。
 * 不写入 workspace——钉选偏好是纯前端个性化补充（同 tsian.statusCollapsed）。
 *
 * localStorage 键 `tsian.statusBarPins`；存储格式 `PinnedStore { version: 1, targets: PinTarget[] }`。
 * 解析/存储异常均静默兜底：
 * - 读取失败 / JSON.parse 失败 / version 不匹配 → 视为空钉选集。
 * - 写入失败 → console.warn，不抛出。
 */
import { readonly, ref, watch } from "vue"
import type { DeepReadonly, Ref } from "vue"
import type { PinPathKind, PinTarget, PinnedStore } from "../lib/pin-types"

const STORAGE_KEY = "tsian.statusBarPins"
const CURRENT_VERSION = 1 as const

function isPinPathKind(v: unknown): v is PinPathKind {
  return (
    v === "status" ||
    v === "attribute" ||
    v === "gauge" ||
    v === "identity" ||
    v === "appearance" ||
    v === "goals"
  )
}

function parsePinTarget(raw: unknown): PinTarget | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const entityRef = r.entityRef
  const kind = r.kind
  const key = r.key
  const label = r.label
  const addedAt = r.addedAt
  if (typeof entityRef !== "string" || entityRef.length === 0) return null
  if (!isPinPathKind(kind)) return null
  if (typeof label !== "string" || label.length === 0) return null
  if (typeof addedAt !== "number" || !Number.isFinite(addedAt)) return null
  const target: PinTarget = { entityRef, kind, label, addedAt }
  if (typeof key === "string" && key.length > 0) target.key = key
  // appearance 无 key；其余 kind 必须有 key
  if (kind !== "appearance" && target.key === undefined) return null
  return target
}

function loadFromStorage(): PinTarget[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null || raw.length === 0) return []
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return []
    const store = parsed as Record<string, unknown>
    if (store.version !== CURRENT_VERSION) return []
    const targets = store.targets
    if (!Array.isArray(targets)) return []
    const out: PinTarget[] = []
    for (const t of targets) {
      const parsedTarget = parsePinTarget(t)
      if (parsedTarget !== null) out.push(parsedTarget)
    }
    return out
  } catch {
    return []
  }
}

function saveToStorage(targets: PinTarget[]): void {
  try {
    const store: PinnedStore = { version: CURRENT_VERSION, targets }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch (err) {
    // 静默兜底：localStorage 满/被禁用等场景不影响交互。
    console.warn("[useStatusBarPins] failed to save pins", err)
  }
}

// 模块级共享状态：所有 useStatusBarPins() 调用共用同一 ref。
const pinsRef: Ref<PinTarget[]> = ref<PinTarget[]>(loadFromStorage())

// 模块级 watch（懒装载，仅一次）：pinsRef 变化即写入 localStorage。
let watching = false
function ensureWatch(): void {
  if (watching) return
  watching = true
  watch(
    pinsRef,
    (v) => {
      saveToStorage(v)
    },
    { deep: true },
  )
}

function keyMatches(a: PinTarget, kind: PinPathKind, key: string | undefined): boolean {
  if (a.kind !== kind) return false
  const aKey = a.key ?? ""
  const bKey = key ?? ""
  return aKey === bKey
}

/**
 * useStatusBarPins — 状态栏钉选偏好单例访问。
 *
 * @returns { pins, isPinned, togglePin, removePin, clearPins }
 */
export function useStatusBarPins(): {
  pins: DeepReadonly<Ref<PinTarget[]>>
  isPinned: (kind: PinPathKind, key?: string) => boolean
  togglePin: (target: Omit<PinTarget, "addedAt">) => void
  removePin: (kind: PinPathKind, key?: string) => void
  clearPins: () => void
} {
  ensureWatch()

  function isPinned(kind: PinPathKind, key?: string): boolean {
    return pinsRef.value.some((t) => keyMatches(t, kind, key))
  }

  function togglePin(target: Omit<PinTarget, "addedAt">): void {
    const idx = pinsRef.value.findIndex((t) => keyMatches(t, target.kind, target.key))
    if (idx >= 0) {
      pinsRef.value.splice(idx, 1)
      return
    }
    const next: PinTarget = {
      entityRef: target.entityRef,
      kind: target.kind,
      label: target.label,
      addedAt: Date.now(),
    }
    if (target.key !== undefined) next.key = target.key
    pinsRef.value.push(next)
  }

  function removePin(kind: PinPathKind, key?: string): void {
    const idx = pinsRef.value.findIndex((t) => keyMatches(t, kind, key))
    if (idx >= 0) pinsRef.value.splice(idx, 1)
  }

  function clearPins(): void {
    if (pinsRef.value.length > 0) pinsRef.value = []
  }

  return {
    /** 只读钉选清单（按 addedAt 顺序，即插入顺序）。 */
    pins: readonly(pinsRef),
    isPinned,
    togglePin,
    removePin,
    clearPins,
  }
}
