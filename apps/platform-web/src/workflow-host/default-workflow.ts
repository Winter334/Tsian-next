/**
 * 平台默认 AIRP 工作流。
 *
 * 默认检索不再使用高层兼容黑盒节点，而是复用内置 AIRP
 * workflow preset：AIRP memory collection queries → record nodes → bounded compute
 * → chat / maintenance / state-write。
 */

import { createDefaultAirpWorkflow } from "../../../../builtin/mods/default-airp-workflow"

export const defaultWorkflow = createDefaultAirpWorkflow()
