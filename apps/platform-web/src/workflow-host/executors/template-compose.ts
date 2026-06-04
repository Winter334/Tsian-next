import type { TemplateComposeNodeConfig } from "@tsian/contracts"
import type { NodeExecutor } from "@tsian/workflow-engine"

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

function resolvePath(root: unknown, path: string[]): unknown {
  let current = root
  for (const part of path) {
    if (typeof current !== "object" || current === null) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function resolveToken(
  token: string,
  inputs: Record<string, unknown>,
  macros: Record<string, string>,
): unknown {
  const wantsJson = token.endsWith(".json")
  const lookup = wantsJson ? token.slice(0, -5) : token

  if (Object.prototype.hasOwnProperty.call(inputs, lookup)) {
    const value = inputs[lookup]
    return wantsJson ? JSON.stringify(value) : value
  }
  if (Object.prototype.hasOwnProperty.call(macros, lookup)) {
    const value = macros[lookup]
    return wantsJson ? JSON.stringify(value) : value
  }

  const path = lookup.split(".").filter(Boolean)
  const value = lookup.startsWith("macros.")
    ? resolvePath(macros, path.slice(1))
    : lookup.startsWith("inputs.")
      ? resolvePath(inputs, path.slice(1))
      : resolvePath(inputs, path) ?? resolvePath(macros, path)
  return wantsJson ? JSON.stringify(value) : value
}

function stringifyTemplateValue(value: unknown): string {
  if (value === undefined || value === null) return ""
  if (typeof value === "string") return value
  return JSON.stringify(value)
}

export const templateComposeExecutor: NodeExecutor = {
  async execute({ node, inputs, context }) {
    const config = readTemplateConfig(node.config)
    const macros = (context as { macros?: Record<string, string> }).macros ?? {}
    const outputName =
      typeof config.outputName === "string" && config.outputName.trim()
        ? config.outputName.trim()
        : "text"

    const rendered = config.template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, token) => {
      const value = resolveToken(String(token).trim(), inputs, macros)
      return stringifyTemplateValue(value)
    })

    return {
      outputs: {
        [outputName]: config.parse === "json" ? JSON.parse(rendered) : rendered,
      },
    }
  },
}

