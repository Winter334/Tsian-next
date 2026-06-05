/**
 * 平台默认 AIRP 工作流。
 *
 * 默认检索不再使用一个高层 event-archive 黑盒节点，而是复用内置 AIRP
 * workflow preset：AIRP memory collection queries → record nodes → bounded compute
 * → chat / maintenance / memory-write。
 */

import { createDefaultAirpWorkflow } from "../../../../builtin/mods/default-airp-workflow"

export const defaultWorkflow = createDefaultAirpWorkflow()
