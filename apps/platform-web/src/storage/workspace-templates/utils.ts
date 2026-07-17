import type { AgentConfig } from "@tsian/contracts"

export interface TemplateFile {
  path: string
  content: string
  mediaType?: string
}

export function text(lines: string[]): string {
  return `${lines.join("\n")}\n`
}

export function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

export function agentConfigContent(config: AgentConfig): string {
  return json(config)
}
