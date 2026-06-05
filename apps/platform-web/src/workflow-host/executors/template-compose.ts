import type { TemplateComposeNodeConfig } from "@tsian/contracts"
import type { NodeExecutor } from "@tsian/workflow-engine"
import { renderWorkflowTemplate } from "./template-utils"

function readTemplateConfig(raw: unknown): TemplateComposeNodeConfig {
  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof (raw as { template?: unknown }).template !== "string"
  ) {
    throw new Error(
      `template-compose node config is invalid: expected { template: string }`,
    )
  }
  return raw as TemplateComposeNodeConfig
}

export const templateComposeExecutor: NodeExecutor = {
  async execute({ node, inputs, context }) {
    const config = readTemplateConfig(node.config)
    const macros = (context as { macros?: Record<string, string> }).macros ?? {}
    const outputName =
      typeof config.outputName === "string" && config.outputName.trim()
        ? config.outputName.trim()
        : "text"

    const rendered = renderWorkflowTemplate(config.template, inputs, macros)

    return {
      outputs: {
        [outputName]: config.parse === "json" ? JSON.parse(rendered) : rendered,
      },
    }
  },
}
