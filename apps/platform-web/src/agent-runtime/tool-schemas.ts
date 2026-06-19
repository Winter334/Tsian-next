import type {
  AgentPlatformToolName,
  AgentRegistryEntry,
  WorkspaceScope,
} from "@tsian/contracts"
import { AGENT_PLATFORM_TOOL_NAMES } from "./permissions"
import {
  RUNTIME_WORKSPACE_TOOL_NAMES,
  type RuntimeAgentCallHistoryMode,
} from "./workspace-tools"

/**
 * A JSON Schema describing one Runtime tool for API-native function calling.
 * `parameters` follows the JSON Schema object shape accepted by OpenAI
 * `tools.function.parameters`, Gemini `functionDeclarations.parameters`, and
 * Claude `input_schema`.
 */
export interface ToolSchema {
  name: string
  description: string
  parameters: Record<string, unknown>
}

const WORKSPACE_SCOPE_ENUM: WorkspaceScope[] = [
  "effective",
  "card-content",
  "save-runtime",
  "platform-meta",
]

const HISTORY_MODE_ENUM: RuntimeAgentCallHistoryMode[] = [
  "minimal",
  "recent",
  "scene",
]

function platformToolEnabled(
  tools: AgentPlatformToolName[],
  tool: AgentPlatformToolName,
): boolean {
  return tools.includes(tool)
}

const skillLoadSchema: ToolSchema = {
  name: RUNTIME_WORKSPACE_TOOL_NAMES.skillLoad,
  description:
    "Load a Skill's entry instructions (SKILL.md) from the current Agent's visible Skill Index by name. Use it to bring in domain skills, style guides, or action packages before acting. Returns the Skill entry content and registers its declared actions for the current tool loop.",
  parameters: {
    type: "object",
    required: ["name"],
    properties: {
      name: {
        type: "string",
        description:
          "The Skill `name` from the visible Skill Index. Matches the SkillRegistryEntry.name; falls back to `id` when the name is absent.",
      },
    },
  },
}

const actionCallSchema: ToolSchema = {
  name: RUNTIME_WORKSPACE_TOOL_NAMES.actionCall,
  description:
    "Invoke an action declared by a Skill that has already been loaded in this tool loop. The action routes through its declared executor (built-in, platform_action, workspace_operation, or browser_script) after input validation.",
  parameters: {
    type: "object",
    required: ["skill", "action"],
    properties: {
      skill: {
        type: "string",
        description: "The name of the previously loaded Skill that declares the action.",
      },
      action: {
        type: "string",
        description: "The declared action name to invoke.",
      },
      input: {
        type: "object",
        description:
          "Action input object. Must satisfy the action's declared inputSchema when present.",
      },
    },
  },
}

const agentCallSchema: ToolSchema = {
  name: RUNTIME_WORKSPACE_TOOL_NAMES.agentCall,
  description:
    "Request a one-off consultation from a contact Agent. The target Agent runs with its own context and permissions; its output returns as an observation to the caller, never directly to the player. Use it when a task needs another Agent's specialized judgment.",
  parameters: {
    type: "object",
    required: ["agentId", "request"],
    properties: {
      agentId: {
        type: "string",
        description: "The contact Agent id to consult. Must be in the current Agent's visible contacts.",
      },
      request: {
        type: "string",
        description: "The consultation request describing what the target Agent should do or judge.",
      },
      reason: {
        type: "string",
        description: "Optional rationale for the consultation.",
      },
      contextSummary: {
        type: "string",
        description: "Optional compact context summary forwarded to the target Agent.",
      },
      expectedOutput: {
        type: "string",
        description: "Optional description of the expected output shape.",
      },
      historyMode: {
        type: "string",
        enum: HISTORY_MODE_ENUM,
        description: "History window handed to the target Agent. Defaults to \"recent\".",
      },
    },
  },
}

const workspaceReadSchema: ToolSchema = {
  name: RUNTIME_WORKSPACE_TOOL_NAMES.workspaceRead,
  description:
    "Read one Runtime Workspace file by scope and path. Use it for third-layer files referenced by a loaded Skill, world data, memory, or other current-task context; do not use it to read Skill entry files (use skill_load for those).",
  parameters: {
    type: "object",
    required: ["scope", "path"],
    properties: {
      scope: {
        type: "string",
        enum: WORKSPACE_SCOPE_ENUM,
        description: "Workspace scope to read from. Usually \"effective\".",
      },
      path: {
        type: "string",
        description: "Workspace file path (forward slashes, no leading slash).",
      },
    },
  },
}

const workspaceListSchema: ToolSchema = {
  name: RUNTIME_WORKSPACE_TOOL_NAMES.workspaceList,
  description:
    "List direct child entries of a workspace directory by scope. Returns entries without file contents. Omit path (or pass empty) to list the root.",
  parameters: {
    type: "object",
    required: ["scope"],
    properties: {
      scope: {
        type: "string",
        enum: WORKSPACE_SCOPE_ENUM,
        description: "Workspace scope to list. Usually \"effective\".",
      },
      path: {
        type: "string",
        description: "Optional directory path relative to the scope root. Empty or omitted means root.",
      },
    },
  },
}

const workspaceSearchSchema: ToolSchema = {
  name: RUNTIME_WORKSPACE_TOOL_NAMES.workspaceSearch,
  description:
    "Search workspace files by query and return scored previews. Use it to locate relevant files before reading specific ones. Empty query returns no results.",
  parameters: {
    type: "object",
    required: ["scope", "query"],
    properties: {
      scope: {
        type: "string",
        enum: WORKSPACE_SCOPE_ENUM,
        description: "Workspace scope to search. Usually \"effective\".",
      },
      query: {
        type: "string",
        description: "Search query text.",
      },
      limit: {
        type: "integer",
        description: "Optional maximum number of results.",
      },
    },
  },
}

const workspacePatchSchema: ToolSchema = {
  name: RUNTIME_WORKSPACE_TOOL_NAMES.workspacePatch,
  description:
    "Write or replace a save-runtime workspace file's content at a path. Use it only when a loaded Skill explicitly requires maintaining state, notes, memory, or frontend view data.",
  parameters: {
    type: "object",
    required: ["scope", "path", "content"],
    properties: {
      scope: {
        type: "string",
        enum: WORKSPACE_SCOPE_ENUM,
        description: "Workspace scope to patch. Ordinary Agent writes use \"save-runtime\".",
      },
      path: {
        type: "string",
        description: "Target workspace file path. Ordinary writes must target \"save/...\".",
      },
      content: {
        type: "string",
        description: "The full new file content.",
      },
      mediaType: {
        type: "string",
        description: "Optional media type for the written file.",
      },
    },
  },
}

const workspaceWriteSchema: ToolSchema = {
  name: RUNTIME_WORKSPACE_TOOL_NAMES.workspaceWrite,
  description:
    "Create or overwrite a workspace file at a path (equivalent to a full-content patch). Use it only when a loaded Skill explicitly requires writing state, notes, memory, or frontend view data.",
  parameters: {
    type: "object",
    required: ["scope", "path", "content"],
    properties: {
      scope: {
        type: "string",
        enum: WORKSPACE_SCOPE_ENUM,
        description: "Workspace scope to write. Ordinary Agent writes use \"save-runtime\".",
      },
      path: {
        type: "string",
        description: "Target workspace file path. Ordinary writes must target \"save/...\".",
      },
      content: {
        type: "string",
        description: "The full file content to write.",
      },
      mediaType: {
        type: "string",
        description: "Optional media type for the written file.",
      },
    },
  }
}

const workspaceDiffSchema: ToolSchema = {
  name: RUNTIME_WORKSPACE_TOOL_NAMES.workspaceDiff,
  description:
    "Compute a diff between a workspace file's current content and a proposed next content, without persisting. Use it to preview a change before patching.",
  parameters: {
    type: "object",
    required: ["scope", "path", "expectedContent"],
    properties: {
      scope: {
        type: "string",
        enum: WORKSPACE_SCOPE_ENUM,
        description: "Workspace scope to diff against.",
      },
      path: {
        type: "string",
        description: "Target workspace file path.",
      },
      expectedContent: {
        type: "string",
        description: "The proposed content to diff against the current file content.",
      },
    },
  },
}

const workspaceMoveSchema: ToolSchema = {
  name: RUNTIME_WORKSPACE_TOOL_NAMES.workspaceMove,
  description:
    "Move or rename a workspace file from one path to another within a scope. Use it only when a loaded Skill explicitly requires reorganizing runtime files.",
  parameters: {
    type: "object",
    required: ["scope", "path", "targetPath"],
    properties: {
      scope: {
        type: "string",
        enum: WORKSPACE_SCOPE_ENUM,
        description: "Workspace scope to move within.",
      },
      path: {
        type: "string",
        description: "Source workspace file path.",
      },
      targetPath: {
        type: "string",
        description: "Destination workspace file path.",
      },
    },
  },
}

const workspaceDeleteSchema: ToolSchema = {
  name: RUNTIME_WORKSPACE_TOOL_NAMES.workspaceDelete,
  description:
    "Delete one or more workspace files matching a path prefix within a scope. Use it only when a loaded Skill explicitly requires removing runtime files.",
  parameters: {
    type: "object",
    required: ["scope", "path"],
    properties: {
      scope: {
        type: "string",
        enum: WORKSPACE_SCOPE_ENUM,
        description: "Workspace scope to delete from.",
      },
      path: {
        type: "string",
        description: "Target workspace file path (or prefix) to delete.",
      },
    },
  },
}

const workspaceValidateSchema: ToolSchema = {
  name: RUNTIME_WORKSPACE_TOOL_NAMES.workspaceValidate,
  description:
    "Validate a workspace file's structure (JSON or frontmatter) without persisting changes. Returns validation errors when invalid.",
  parameters: {
    type: "object",
    required: ["scope", "path"],
    properties: {
      scope: {
        type: "string",
        enum: WORKSPACE_SCOPE_ENUM,
        description: "Workspace scope to validate against.",
      },
      path: {
        type: "string",
        description: "Target workspace file path to validate.",
      },
      validator: {
        type: "string",
        enum: ["json", "frontmatter"],
        description: "Optional validator kind. Defaults to inferred-from-path behavior.",
      },
      autoFix: {
        type: "boolean",
        description: "Whether to attempt an automatic fix when validation fails.",
      },
    },
  },
}

/**
 * Build the JSON Schema tool list for API-native function calling, gated by the
 * same Agent platform-tool enablement that the text-protocol prompt uses.
 *
 * `skill_load` and `action_call` are always available because Skill
 * installation/enablement is player/card-author controlled. `agent_call` is
 * gated by contacts + the `agent_call` platform tool. Workspace read tools are
 * gated by `workspace_read`; workspace write/delete/move/validate tools by
 * `workspace_write`.
 */
export function buildEnabledToolSchemas(options: {
  enabledPlatformTools: AgentPlatformToolName[]
  allowAgentCall: boolean
  visibleContacts: AgentRegistryEntry[]
}): ToolSchema[] {
  const canCallAgents =
    options.allowAgentCall && options.visibleContacts.length > 0
  const canReadWorkspace = platformToolEnabled(
    options.enabledPlatformTools,
    AGENT_PLATFORM_TOOL_NAMES.workspaceRead,
  )
  const canWriteWorkspace = platformToolEnabled(
    options.enabledPlatformTools,
    AGENT_PLATFORM_TOOL_NAMES.workspaceWrite,
  )

  const schemas: ToolSchema[] = [skillLoadSchema, actionCallSchema]

  if (canCallAgents) {
    schemas.push(agentCallSchema)
  }

  if (canReadWorkspace) {
    schemas.push(
      workspaceReadSchema,
      workspaceListSchema,
      workspaceSearchSchema,
    )
  }

  if (canWriteWorkspace) {
    schemas.push(
      workspaceDiffSchema,
      workspacePatchSchema,
      workspaceWriteSchema,
      workspaceMoveSchema,
      workspaceDeleteSchema,
      workspaceValidateSchema,
    )
  }

  return schemas
}
