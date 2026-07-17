import type { AttachmentRef } from "@tsian/contracts"

/** Empty-state prompt shown before a conversation starts. */
export interface AssistantSuggestion {
  label: string
  message: string
}

/** 待发附件草稿(paste/drop/pick 添加后,send 前可移除). */
export interface PendingAttachment {
  ref: AttachmentRef
  /** 图片缩略图 URL (URL.createObjectURL). */
  previewUrl?: string
}

/** ask_user 活跃提问状态(按 turn 隔离,存于 turn state). */
export interface ActiveAskState {
  requestId: string
  question: string
  options?: string[]
  allowCustom?: boolean
}

/** recordAskNode 回调入参类型(镜像 useAssistantTimeline.recordAskNode). */
export interface RecordAskInput {
  requestId: string
  question: string
  options?: string[]
  allowCustom?: boolean
  answer?: string
  cancelled?: boolean
}
