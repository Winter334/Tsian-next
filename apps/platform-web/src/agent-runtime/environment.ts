import type { WorkspaceFile } from "@tsian/contracts"
import {
  workspaceFileFilterForAgentBoundary,
} from "./frontend-action-isolation"
import type { AgentRuntimeEnvironment } from "./turn-types"
import type { WorkspaceOperationMutationAdapter } from "./workspace-operations"

type DesktopEnvironmentInput = Omit<AgentRuntimeEnvironment, "workspace" | "context"> & {
  workspace: Omit<AgentRuntimeEnvironment["workspace"], "trustBoundary">
  context: Omit<AgentRuntimeEnvironment["context"], "compressionMode">
}

type GameEnvironmentInput = Omit<AgentRuntimeEnvironment, "workspace"> & {
  workspace: Omit<AgentRuntimeEnvironment["workspace"], "trustBoundary">
}

export function deriveDelegatedWorkspaceMutations(
  mutations: WorkspaceOperationMutationAdapter | undefined,
): WorkspaceOperationMutationAdapter | undefined {
  if (!mutations) return undefined
  return {
    write(input) {
      if (input.scope === "save-runtime") return mutations.write(input)
      if (
        input.scope === "platform-meta"
        && input.path !== ".tsian/local"
        && !input.path.startsWith(".tsian/local/")
      ) {
        return mutations.write(input)
      }
      throw new Error("Delegated runtime Agents can only write save-runtime or game platform-meta paths.")
    },
    delete(input) {
      if (input.scope === "save-runtime") return mutations.delete(input)
      throw new Error("Delegated runtime Agents can only delete save-runtime paths.")
    },
  }
}

export function createDesktopAssistantEnvironment(
  input: DesktopEnvironmentInput,
): AgentRuntimeEnvironment {
  return {
    ...input,
    workspace: {
      ...input.workspace,
      // Keep the host transaction's live array. Trust filtering belongs to
      // context assembly and per-operation fileFilter; copying here would make
      // later Tool reads miss same-turn staged writes/deletes.
      files: input.workspace.files,
      fileFilter: workspaceFileFilterForAgentBoundary("trusted-authoring"),
      trustBoundary: "trusted-authoring",
    },
    context: { ...input.context, compressionMode: "task" },
  }
}

export function createGameRuntimeEnvironment(
  input: GameEnvironmentInput,
): AgentRuntimeEnvironment {
  return {
    ...input,
    workspace: {
      ...input.workspace,
      files: input.workspace.files,
      fileFilter: workspaceFileFilterForAgentBoundary("runtime-game-agent"),
      trustBoundary: "runtime-game-agent",
    },
  }
}

/** Delegation always re-derives a fail-closed game view. Desktop-only
 * controlled ports are removed even if a target Agent declares the same tool
 * name in editable config. */
export function deriveDelegatedEnvironment(
  environment: AgentRuntimeEnvironment,
  files: WorkspaceFile[] = environment.workspace.files,
): AgentRuntimeEnvironment {
  return {
    ...environment,
    workspace: {
      ...environment.workspace,
      files,
      trustBoundary: "runtime-game-agent",
      fileFilter: workspaceFileFilterForAgentBoundary("runtime-game-agent"),
      toolFilter: undefined,
      mutations: deriveDelegatedWorkspaceMutations(environment.workspace.mutations),
    },
    context: {
      ...environment.context,
      snapshot: undefined,
      compressionMode: "task",
    },
    controlledTools: {
      browserScript: environment.controlledTools.browserScript,
      actionExecutorPolicy: environment.controlledTools.actionExecutorPolicy,
    },
  }
}
