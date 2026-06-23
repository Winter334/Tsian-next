import type {
  AgentPlatformToolName,
  AgentRegistryEntry,
  WorkspaceOperationName,
} from "@tsian/contracts"

export const AGENT_PLATFORM_TOOL_NAMES = {
  agentCall: "agent_call",
  workspaceRead: "workspace_read",
  workspaceWrite: "workspace_write",
  inspectFrontend: "inspect_frontend",
} as const satisfies Record<string, AgentPlatformToolName>

export const DEFAULT_AGENT_PLATFORM_TOOLS: AgentPlatformToolName[] = [
  AGENT_PLATFORM_TOOL_NAMES.agentCall,
  AGENT_PLATFORM_TOOL_NAMES.workspaceRead,
  AGENT_PLATFORM_TOOL_NAMES.workspaceWrite,
]

export const WORKSPACE_READ_OPERATIONS: WorkspaceOperationName[] = [
  "list",
  "search",
  "read",
  "glob",
]

export const WORKSPACE_WRITE_OPERATIONS: WorkspaceOperationName[] = [
  "diff",
  "write",
  "move",
  "delete",
]

export interface AgentRuntimePermissionProfile {
  enabledTools: AgentPlatformToolName[]
  workspaceActorLevel: number
  exposedWorkspaceOperations: WorkspaceOperationName[]
}

function uniqueItems<T extends string>(values: Iterable<T>): T[] {
  return Array.from(new Set(values))
}

export function enabledAgentPlatformTools(
  agent: AgentRegistryEntry,
): AgentPlatformToolName[] {
  const enabled = agent.platformTools.enabled.length > 0
    ? agent.platformTools.enabled
    : DEFAULT_AGENT_PLATFORM_TOOLS
  const disabled = new Set(agent.platformTools.disabled)
  return uniqueItems(enabled.filter((tool) => !disabled.has(tool)))
}

export function isAgentPlatformToolEnabled(
  agent: AgentRegistryEntry,
  tool: AgentPlatformToolName,
): boolean {
  return enabledAgentPlatformTools(agent).includes(tool)
}

export function exposedWorkspaceOperationsForAgent(
  agent: AgentRegistryEntry,
): WorkspaceOperationName[] {
  const operations: WorkspaceOperationName[] = []
  if (isAgentPlatformToolEnabled(agent, AGENT_PLATFORM_TOOL_NAMES.workspaceRead)) {
    operations.push(...WORKSPACE_READ_OPERATIONS)
  }
  if (isAgentPlatformToolEnabled(agent, AGENT_PLATFORM_TOOL_NAMES.workspaceWrite)) {
    operations.push(...WORKSPACE_WRITE_OPERATIONS)
  }

  return uniqueItems(operations)
}

export function deriveAgentRuntimePermissionProfile(
  agent: AgentRegistryEntry,
): AgentRuntimePermissionProfile {
  return {
    enabledTools: enabledAgentPlatformTools(agent),
    workspaceActorLevel: agent.workspaceAccess.level,
    exposedWorkspaceOperations: exposedWorkspaceOperationsForAgent(agent),
  }
}
