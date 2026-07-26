import type { TemplateFile } from "../utils"
import actionManifest from "../../../../../../cards/沉浸阅读器.tsian-card/workspace/frontend-actions/equipment/action.json?raw"
import actionCore from "../../../../../../cards/沉浸阅读器.tsian-card/workspace/frontend-actions/equipment/equipment-core.js?raw"
import actionRun from "../../../../../../cards/沉浸阅读器.tsian-card/workspace/frontend-actions/equipment/run.js?raw"

export const EQUIPMENT_FRONTEND_ACTION_FILES: TemplateFile[] = [
  { path: "frontend-actions/equipment/action.json", content: actionManifest },
  { path: "frontend-actions/equipment/equipment-core.js", content: actionCore },
  { path: "frontend-actions/equipment/run.js", content: actionRun },
]
