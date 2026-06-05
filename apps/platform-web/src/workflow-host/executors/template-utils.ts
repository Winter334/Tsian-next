export function resolvePath(root: unknown, path: string[]): unknown {
  let current = root
  for (const part of path) {
    if (typeof current !== "object" || current === null) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

export function stringifyTemplateValue(value: unknown): string {
  if (value === undefined || value === null) return ""
  if (typeof value === "string") return value
  return JSON.stringify(value)
}

export function resolveTemplateToken(
  token: string,
  inputs: Record<string, unknown>,
  macros: Record<string, string>,
  locals: Record<string, unknown> = {},
): unknown {
  const wantsJson = token.endsWith(".json")
  const lookup = wantsJson ? token.slice(0, -5) : token

  if (Object.prototype.hasOwnProperty.call(locals, lookup)) {
    const value = locals[lookup]
    return wantsJson ? JSON.stringify(value) : value
  }
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
      : lookup.startsWith("item.")
        ? resolvePath(locals.item, path.slice(1))
        : lookup.startsWith("record.")
          ? resolvePath(locals.record, path.slice(1))
          : resolvePath(locals, path) ??
            resolvePath(inputs, path) ??
            resolvePath(macros, path)
  return wantsJson ? JSON.stringify(value) : value
}

export function renderWorkflowTemplate(
  template: string,
  inputs: Record<string, unknown>,
  macros: Record<string, string>,
  locals: Record<string, unknown> = {},
): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, token) => {
    const value = resolveTemplateToken(String(token).trim(), inputs, macros, locals)
    return stringifyTemplateValue(value)
  })
}
