import { computed, onBeforeUnmount, ref } from "vue"
import {
  FrontendActionError,
  type JsonValue,
  type RuntimeWorkspaceMutationEvent,
  type TsianApi,
} from "@tsian/play-bridge"
import type { CharacterEntity, CharacterEquipmentSlot } from "../lib/character-types"
import { parseEntityRef } from "../lib/entity-ref"
import type { EquipmentCandidate } from "../lib/load-character-inventory"
import { discoverCharacterInventoryWithTsian } from "../lib/load-character-inventory"
import {
  parseEquipmentActionOutput,
  previewIdentity,
  samePreviewIdentity,
  type EquipmentActionInput,
  type EquipmentMutationResult,
  type EquipmentPreviewIdentity,
} from "../lib/equipment-action"

export interface EquipmentSlotSelection {
  slotType: string
  slotIndex: number
  slot: CharacterEquipmentSlot
  trigger: HTMLElement | null
}

export function publicEquipmentMessage(error: unknown): string {
  if (!(error instanceof FrontendActionError)) return "装备请求未能完成，请稍后再试。"
  if (error.code === "EQUIPMENT_REFRESH_REQUIRED") return "装备记录需要先由场记维护刷新，完成后再试。"
  if (error.code === "EQUIPMENT_EXPECTED_REF_MISMATCH" || error.code === "FRONTEND_ACTION_WORKSPACE_CONFLICT") {
    return "角色状态刚刚发生变化，请重新选择并预览。"
  }
  if (error.code === "EQUIPMENT_ITEM_NOT_REACHABLE" || error.code === "EQUIPMENT_QUANTITY_EXHAUSTED") {
    return "这件物品当前不可用于该装备槽。"
  }
  if (error.code === "EQUIPMENT_SLOT_TYPE_MISMATCH") return "这件物品不适合当前槽位。"
  if (error.code === "FRONTEND_ACTION_ABORTED") return ""
  return "装备数据暂时不可用，请让场记检查角色与物品记录。"
}

export function useEquipmentManagement(
  tsian: TsianApi,
  getCharacter: () => CharacterEntity | null,
  onAuthoritativeReload: () => Promise<void>,
) {
  const open = ref(false)
  const selection = ref<EquipmentSlotSelection | null>(null)
  const candidates = ref<EquipmentCandidate[]>([])
  const inventoryReadPaths = ref<string[]>([])
  const candidatesLoading = ref(false)
  const selectedItemRef = ref<string | null>(null)
  const preview = ref<EquipmentMutationResult | null>(null)
  const acceptedIdentity = ref<EquipmentPreviewIdentity | null>(null)
  const previewPending = ref(false)
  const commitPending = ref(false)
  const errorMessage = ref("")
  const successMessage = ref("")
  let previewController: AbortController | null = null
  let previewGeneration = 0
  let inventoryGeneration = 0
  let relevantMutationDuringCommit = false

  const compatibleCandidates = computed(() => candidates.value.filter((candidate) =>
    candidate.status === "ready"
      && candidate.item?.type === "equipment"
      && candidate.item.equipmentStatus === "ready"
      && candidate.item.equipment?.slotType === selection.value?.slotType,
  ))

  function invalidatePreview(): void {
    previewGeneration += 1
    previewController?.abort()
    previewController = null
    previewPending.value = false
    preview.value = null
    acceptedIdentity.value = null
  }

  function syncSelectionFromCharacter(): boolean {
    const character = getCharacter()
    const current = selection.value
    if (!character || !current || character.equipmentStatus !== "ready") return false
    const slot = character.equipment?.[current.slotType]?.[current.slotIndex]
    if (!slot) return false
    selection.value = { ...current, slot }
    return true
  }

  function eventTouchesManagedState(event: RuntimeWorkspaceMutationEvent): boolean {
    const character = getCharacter()
    const characterPath = character ? parseEntityRef(character.id, "character")?.path : null
    if (!characterPath) return false
    const paths = new Set([...event.writtenPaths, ...event.deletedPaths])
    if (paths.has(characterPath)) return true
    if (Array.from(paths).some((path) =>
      path.startsWith("save/entities/character/")
      || path.startsWith("save/entities/container/"))) return true
    if (candidatesLoading.value && Array.from(paths).some((path) => path.startsWith("save/entities/item/"))) return true
    return inventoryReadPaths.value.some((path) => paths.has(path))
  }

  async function reconcileAuthoritativeState(): Promise<void> {
    await onAuthoritativeReload()
    syncSelectionFromCharacter()
    await loadCandidates()
  }

  async function reconcileCommitMutations(): Promise<void> {
    do {
      relevantMutationDuringCommit = false
      await reconcileAuthoritativeState()
    } while (relevantMutationDuringCommit)
  }

  async function loadCandidates(): Promise<void> {
    const character = getCharacter()
    if (!character || !open.value) return
    const generation = ++inventoryGeneration
    candidatesLoading.value = true
    try {
      const result = await discoverCharacterInventoryWithTsian(character, tsian)
      if (generation !== inventoryGeneration || !open.value) return
      candidates.value = result.candidates
      inventoryReadPaths.value = result.readPaths
    } catch {
      if (generation !== inventoryGeneration || !open.value) return
      candidates.value = []
      inventoryReadPaths.value = []
      errorMessage.value = "持有物品暂时不可读，请稍后再试。"
    } finally {
      if (generation === inventoryGeneration) candidatesLoading.value = false
    }
  }

  function show(slot: EquipmentSlotSelection): void {
    const character = getCharacter()
    if (!character || character.equipmentStatus !== "ready") return
    invalidatePreview()
    selection.value = slot
    selectedItemRef.value = null
    candidates.value = []
    inventoryReadPaths.value = []
    errorMessage.value = ""
    successMessage.value = ""
    open.value = true
    void loadCandidates()
  }

  function hide(): void {
    invalidatePreview()
    inventoryGeneration += 1
    open.value = false
    selection.value = null
    selectedItemRef.value = null
    candidatesLoading.value = false
    errorMessage.value = ""
    successMessage.value = ""
  }

  function requestFor(operation: "equip" | "unequip", itemRef?: string): EquipmentActionInput | null {
    const character = getCharacter()
    const slot = selection.value
    if (!character || !slot) return null
    if (operation === "unequip") {
      if (slot.slot.ref === null) return null
      return {
        mode: "preview",
        operation,
        characterRef: character.id,
        slotType: slot.slotType,
        slotIndex: slot.slotIndex,
        expectedCurrentRef: slot.slot.ref,
      }
    }
    if (!itemRef) return null
    return {
      mode: "preview",
      operation,
      characterRef: character.id,
      slotType: slot.slotType,
      slotIndex: slot.slotIndex,
      expectedCurrentRef: slot.slot.ref,
      itemRef,
    }
  }

  async function runPreview(operation: "equip" | "unequip", itemRef?: string): Promise<void> {
    const request = requestFor(operation, itemRef)
    if (!request) return
    invalidatePreview()
    const generation = previewGeneration
    const identity = previewIdentity(request)
    const controller = new AbortController()
    previewController = controller
    previewPending.value = true
    errorMessage.value = ""
    successMessage.value = ""
    selectedItemRef.value = request.operation === "equip" ? request.itemRef : null
    try {
      const raw = await tsian.card.runAction("equipment", request as unknown as JsonValue, { signal: controller.signal })
      const parsed = parseEquipmentActionOutput(raw, request)
      if (!parsed) throw new Error("Equipment Action output is invalid.")
      const currentRequest = requestFor(operation, itemRef)
      if (generation !== previewGeneration
        || !open.value
        || !currentRequest
        || !samePreviewIdentity(identity, previewIdentity(currentRequest))) return
      preview.value = parsed
      acceptedIdentity.value = identity
    } catch (error) {
      if (generation !== previewGeneration) return
      errorMessage.value = publicEquipmentMessage(error)
    } finally {
      if (generation === previewGeneration) {
        previewPending.value = false
        previewController = null
      }
    }
  }

  async function commit(): Promise<void> {
    const identity = acceptedIdentity.value
    if (!preview.value || !identity || commitPending.value) return
    const request: EquipmentActionInput = identity.operation === "equip"
      ? {
          mode: "commit",
          operation: "equip",
          characterRef: identity.characterRef,
          slotType: identity.slotType,
          slotIndex: identity.slotIndex,
          expectedCurrentRef: identity.expectedCurrentRef,
          itemRef: identity.itemRef as string,
        }
      : {
          mode: "commit",
          operation: "unequip",
          characterRef: identity.characterRef,
          slotType: identity.slotType,
          slotIndex: identity.slotIndex,
          expectedCurrentRef: identity.expectedCurrentRef as string,
        }
    const immutableRequest = { ...request } as EquipmentActionInput
    relevantMutationDuringCommit = false
    commitPending.value = true
    errorMessage.value = ""
    successMessage.value = ""
    try {
      const raw = await tsian.card.runAction("equipment", immutableRequest as unknown as JsonValue)
      if (!parseEquipmentActionOutput(raw, immutableRequest)) throw new Error("Equipment Action output is invalid.")
      invalidatePreview()
      selectedItemRef.value = null
      await reconcileCommitMutations()
      successMessage.value = immutableRequest.operation === "equip" ? "装备变更已写入。" : "装备已卸下。"
    } catch (error) {
      const message = publicEquipmentMessage(error)
      const mustReread = relevantMutationDuringCommit
        || error instanceof FrontendActionError
          && (error.code === "EQUIPMENT_EXPECTED_REF_MISMATCH" || error.code === "FRONTEND_ACTION_WORKSPACE_CONFLICT")
      invalidatePreview()
      selectedItemRef.value = null
      if (mustReread) await reconcileCommitMutations()
      else await loadCandidates()
      errorMessage.value = message
    } finally {
      relevantMutationDuringCommit = false
      commitPending.value = false
    }
  }

  async function handleWorkspaceMutation(event: RuntimeWorkspaceMutationEvent): Promise<void> {
    if (!open.value || !eventTouchesManagedState(event)) return
    invalidatePreview()
    selectedItemRef.value = null
    if (commitPending.value) {
      relevantMutationDuringCommit = true
      return
    }
    await reconcileAuthoritativeState()
    errorMessage.value = "角色或物品状态已变化，请重新预览。"
  }

  onBeforeUnmount(() => {
    inventoryGeneration += 1
    invalidatePreview()
  })

  return {
    open,
    selection,
    candidates,
    compatibleCandidates,
    candidatesLoading,
    selectedItemRef,
    preview,
    previewPending,
    commitPending,
    errorMessage,
    successMessage,
    show,
    hide,
    runPreview,
    commit,
    handleWorkspaceMutation,
  }
}
