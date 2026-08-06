import type { SpatialWindowPresentationEvent } from "./window-presentation"
import { SpatialWindowPresentationController } from "./window-presentation"
import { SPATIAL_CONFIRM_PANEL_PRESENTATION_ID } from "./spatial-confirm"
import {
  SPATIAL_ASSISTANT_CONFIG_PRESENTATION_ID,
  SPATIAL_DIALOG_PANEL_PRESENTATION_ID,
} from "./spatial-global-surfaces"

export interface SpatialGlobalModalCloseRequest {
  readonly accepted: boolean
  readonly events: readonly SpatialWindowPresentationEvent[]
}

export interface SpatialGlobalModalCloseCompletions {
  readonly confirm?: { readonly value: boolean | string | null }
  readonly dialog?: { readonly confirm: boolean }
  readonly assistantConfig?: true
}

/**
 * Owns only the shell's delayed modal resolutions. The composable stores stay
 * pending while the renderer retains and closes the panel texture.
 */
export class SpatialGlobalModalCloseLifecycle {
  private pendingConfirm: { value: boolean | string | null } | null = null
  private pendingDialog: { confirm: boolean } | null = null
  private pendingAssistantConfig = false

  get confirmPending(): boolean {
    return this.pendingConfirm !== null
  }

  get dialogPending(): boolean {
    return this.pendingDialog !== null
  }

  get assistantConfigPending(): boolean {
    return this.pendingAssistantConfig
  }

  get hasPending(): boolean {
    return this.confirmPending || this.dialogPending || this.assistantConfigPending
  }

  requestConfirm(
    presentation: SpatialWindowPresentationController,
    value: boolean | string | null,
    timestamp: number,
    animate: boolean,
  ): SpatialGlobalModalCloseRequest {
    if (this.pendingConfirm) return { accepted: false, events: [] }
    if (!presentation.beginGuard(SPATIAL_CONFIRM_PANEL_PRESENTATION_ID)) {
      return { accepted: false, events: [] }
    }
    this.pendingConfirm = { value }
    return {
      accepted: true,
      events: presentation.startClosing(
        SPATIAL_CONFIRM_PANEL_PRESENTATION_ID,
        timestamp,
        animate,
      ),
    }
  }

  requestDialog(
    presentation: SpatialWindowPresentationController,
    confirm: boolean,
    timestamp: number,
    animate: boolean,
  ): SpatialGlobalModalCloseRequest {
    if (this.pendingDialog) return { accepted: false, events: [] }
    if (!presentation.beginGuard(SPATIAL_DIALOG_PANEL_PRESENTATION_ID)) {
      return { accepted: false, events: [] }
    }
    this.pendingDialog = { confirm }
    return {
      accepted: true,
      events: presentation.startClosing(
        SPATIAL_DIALOG_PANEL_PRESENTATION_ID,
        timestamp,
        animate,
      ),
    }
  }

  requestAssistantConfig(
    presentation: SpatialWindowPresentationController,
    timestamp: number,
    animate: boolean,
  ): SpatialGlobalModalCloseRequest {
    if (this.pendingAssistantConfig) return { accepted: false, events: [] }
    if (!presentation.beginGuard(SPATIAL_ASSISTANT_CONFIG_PRESENTATION_ID)) {
      return { accepted: false, events: [] }
    }
    this.pendingAssistantConfig = true
    return {
      accepted: true,
      events: presentation.startClosing(
        SPATIAL_ASSISTANT_CONFIG_PRESENTATION_ID,
        timestamp,
        animate,
      ),
    }
  }

  complete(
    presentation: SpatialWindowPresentationController,
    events: readonly SpatialWindowPresentationEvent[],
  ): SpatialGlobalModalCloseCompletions {
    let confirm: SpatialGlobalModalCloseCompletions["confirm"]
    let dialog: SpatialGlobalModalCloseCompletions["dialog"]
    let assistantConfig: SpatialGlobalModalCloseCompletions["assistantConfig"]
    for (const event of events) {
      if (event.kind !== "close-ready") continue
      if (event.windowId === SPATIAL_CONFIRM_PANEL_PRESENTATION_ID) {
        if (!this.pendingConfirm || !presentation.completeClose(event.windowId)) continue
        confirm = this.pendingConfirm
        this.pendingConfirm = null
      } else if (event.windowId === SPATIAL_DIALOG_PANEL_PRESENTATION_ID) {
        if (!this.pendingDialog || !presentation.completeClose(event.windowId)) continue
        dialog = this.pendingDialog
        this.pendingDialog = null
      } else if (event.windowId === SPATIAL_ASSISTANT_CONFIG_PRESENTATION_ID) {
        if (!this.pendingAssistantConfig || !presentation.completeClose(event.windowId)) continue
        assistantConfig = true
        this.pendingAssistantConfig = false
      }
    }
    return { confirm, dialog, assistantConfig }
  }

  forget(presentationId: string): void {
    if (presentationId === SPATIAL_CONFIRM_PANEL_PRESENTATION_ID) {
      this.pendingConfirm = null
    } else if (presentationId === SPATIAL_DIALOG_PANEL_PRESENTATION_ID) {
      this.pendingDialog = null
    } else if (presentationId === SPATIAL_ASSISTANT_CONFIG_PRESENTATION_ID) {
      this.pendingAssistantConfig = false
    }
  }

  clear(): void {
    this.pendingConfirm = null
    this.pendingDialog = null
    this.pendingAssistantConfig = false
  }
}
