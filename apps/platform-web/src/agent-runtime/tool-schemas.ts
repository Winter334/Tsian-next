import type {
  AgentPlatformToolName,
  AgentRegistryEntry,
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

const useSkillSchema: ToolSchema = {
  name: RUNTIME_WORKSPACE_TOOL_NAMES.useSkill,
  description:
    "Declare intent to use a Skill from the current Agent's visible Skill Index by name. The framework injects the Skill's full SKILL.md into the next round's context and registers its declared browser_script actions for run_script. Returns a lightweight confirmation plus the action list (not the full SKILL.md — that arrives as context next round). Example: use_skill with name=\"prose-style\".",
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

const runScriptSchema: ToolSchema = {
  name: RUNTIME_WORKSPACE_TOOL_NAMES.runScript,
  description:
    "Execute a browser_script action declared by a Skill that has already been activated via use_skill in this tool loop. The action runs the Skill's browser script through the Tsian SDK after input validation. Single workspace operations should use the top-level workspace tools directly; multi-step orchestration belongs in a browser_script. Calling run_script before activating the skill with use_skill returns a SKILL_NOT_ACTIVATED error. Example: run_script with skill=\"prose-style\", script=\"example_action\", input={...}.",
  parameters: {
    type: "object",
    required: ["skill", "script"],
    properties: {
      skill: {
        type: "string",
        description: "The name of the previously activated Skill that declares the action.",
      },
      script: {
        type: "string",
        description: "The declared action name returned by use_skill to execute.",
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
    "Request a one-off consultation from a contact Agent. The target Agent runs with its own context and permissions; its output returns as an observation to the caller, never directly to the player. Use it when a task needs another Agent's specialized judgment. Example: agent_call with agentId, request, and optional historyMode/timeoutMs.",
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
      timeoutMs: {
        type: "integer",
        description:
          "Optional timeout quota in milliseconds for this delegated agent call. When elapsed, the call aborts softly and returns an AGENT_CALL_FAILED observation with timeout details. Defaults to 300000 (300s). Increase it only when the target Agent's task is expected to take longer (e.g. reading many files).",
      },
    },
  },
}

const inspectFrontendSchema: ToolSchema = {
  name: RUNTIME_WORKSPACE_TOOL_NAMES.inspectFrontend,
  description:
    "Inspect the active game card's packaged frontend in a hidden iframe using the real /play load path, returning a structural + diagnostic snapshot. The structural `domSummary` is an aria snapshot (accessibility tree YAML: role + accessible name + state), not raw HTML. Supports driving one master agent turn (send), DOM interactions (actions), and refreshing the latest snapshot (refresh); these compose to cover a full player flow. No cardId — the active card is inspected. Use it to close the write→inspect→fix loop on authored frontends. Example: inspect_frontend with send={message:\"...\"}, or actions=[{type:\"click\",selector:\"#send\"}], observeBetween=true.",
  parameters: {
    type: "object",
    properties: {
      send: {
        type: "object",
        description:
          "Drive one master agent turn on an ephemeral save (consumes tokens). The ephemeral save is discarded after the turn, leaving player saves untouched.",
        properties: {
          message: { type: "string" },
        },
        required: ["message"],
      },
      actions: {
        type: "array",
        description:
          "DOM interactions applied to the loaded frontend (same-origin). Each entry: { type, selector, text?, key?, to?, value?, label?, checked? }. Types: click, type (append key events), press, scroll, selectOption (select by value/label), check (checkbox/radio), fill (replace input value), hover, focus.",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["click", "type", "press", "scroll", "selectOption", "check", "fill", "hover", "focus"] },
            selector: { type: "string" },
            text: { type: "string", description: "type/fill: text to input" },
            key: { type: "string", description: "press: key name" },
            to: { type: "string", enum: ["top", "bottom"], description: "scroll: target position" },
            value: { type: "string", description: "selectOption: option value to select" },
            label: { type: "string", description: "selectOption: option text to match" },
            checked: { type: "boolean", description: "check: true (default) to check, false to uncheck" },
          },
          required: ["type", "selector"],
        },
      },
      observeBetween: {
        type: "boolean",
        description:
          "Take a structural snapshot between each action to observe stepwise state changes.",
      },
      refresh: {
        type: "boolean",
        description:
          "Pull the latest runtime snapshot after operations (semantic wrapper — no bridge protocol knowledge needed).",
      },
      wait: {
        type: "string",
        enum: ["bridge-ready", "turn-completed"],
        description: "Observation point to wait for. Defaults to \"bridge-ready\".",
      },
      autoWait: {
        type: "boolean",
        description: "Wait for each action target to be actionable (visible + enabled) before executing. Defaults to true; set false to fall back to immediate query (throws INSPECT_SELECTOR_NOT_FOUND if missing).",
      },
    },
  },
}

const workspaceReadSchema: ToolSchema = {
  name: RUNTIME_WORKSPACE_TOOL_NAMES.read,
  description:
    "Read one Runtime Workspace file by path. Use it for third-layer files referenced by an activated Skill, world data, memory, or other current-task context; do not use it to read Skill entry files (use use_skill for those). Returns the file content as a string. Returns an error if the path does not exist. Pass `offset`/`limit` to read a line slice of a long file; the result then carries `totalLines`/`returnedLines`/`offset`/`truncated` so you can decide whether to page further.",
  parameters: {
    type: "object",
    required: ["path"],
    properties: {
      path: {
        type: "string",
        description: "Workspace file path (forward slashes, no leading slash).",
      },
      offset: {
        type: "integer",
        description: "1-based start line for line-level slicing (default 1). Use with `limit` to page through long files.",
      },
      limit: {
        type: "integer",
        description: "Maximum lines to return (default 2000, hard cap 5000). Omit to return the whole file.",
      },
    },
  },
}

const workspaceListSchema: ToolSchema = {
  name: RUNTIME_WORKSPACE_TOOL_NAMES.list,
  description:
    "List direct child entries of a workspace directory by path. Returns entries without file contents. Omit path (or pass empty) to list the root.",
  parameters: {
    type: "object",
    required: [],
    properties: {
      path: {
        type: "string",
        description: "Optional directory path to list. Empty, omitted, or `.` means the workspace root.",
      },
    },
  },
}

const workspaceSearchSchema: ToolSchema = {
  name: RUNTIME_WORKSPACE_TOOL_NAMES.search,
  description:
    "Search workspace files and return per-file match lists (line number + matched line + context lines). Pass either `query` (substring, case-insensitive by default) or `pattern` (regex, case-sensitive by default) — not both. Empty/omitted query and pattern return no results. Use it to locate relevant files and lines before reading specific ones.",
  parameters: {
    type: "object",
    required: [],
    properties: {
      query: {
        type: "string",
        description: "Substring search text. Case-insensitive by default. Mutually exclusive with `pattern`.",
      },
      pattern: {
        type: "string",
        description: "Regular expression to match line content. Case-sensitive by default. Use for structured retrieval such as JSON state tables or frontmatter. Mutually exclusive with `query`.",
      },
      contextLines: {
        type: "integer",
        description: "Context lines to return before and after each match (default 0).",
      },
      ignoreCase: {
        type: "boolean",
        description: "Override case sensitivity. `query` defaults to true, `pattern` defaults to false.",
      },
      limit: {
        type: "integer",
        description: "Optional maximum number of files to return.",
      },
    },
  },
}

const workspaceGlobSchema: ToolSchema = {
  name: RUNTIME_WORKSPACE_TOOL_NAMES.glob,
  description:
    "Recursively match workspace file paths by glob pattern and return the matching path list (no file contents). Use it to locate files by name pattern without walking directories one level at a time. Returns an array of matching file paths; empty array if no matches.",
  parameters: {
    type: "object",
    required: ["pattern"],
    properties: {
      pattern: {
        type: "string",
        description:
          "Glob pattern supporting ** (cross-directory), * (single-level, no /), ? (single char, no /). Examples: **/agent.json, skills/**/*.md, *.md",
      },
      limit: {
        type: "integer",
        description: "Max matches to return. Default 50, max 200.",
      },
    },
  },
}

const workspaceWriteSchema: ToolSchema = {
  name: RUNTIME_WORKSPACE_TOOL_NAMES.write,
  description:
    "Create or overwrite a workspace file at a path (equivalent to a full-content patch). Use it only when a loaded Skill explicitly requires writing state, notes, memory, or frontend view data. Returns the written file metadata. Returns an error if the path is not writable for the current Agent. Use path prefixes to target the right area: \"save/...\" for runtime saves, \"temp/...\" for transient scratch files, \"frontend/...\" for frontend view data, \".tsian/...\" for platform metadata, anything else for card content.",
  parameters: {
    type: "object",
    required: ["path", "content"],
    properties: {
      path: {
        type: "string",
        description:
          "Target workspace file path. Use \"save/...\" for runtime saves, \"temp/...\" for transient scratch files, \"frontend/...\" for frontend view data, \".tsian/...\" for platform metadata, anything else for card content.",
      },
      content: {
        type: "string",
        description: "The full file content to write.",
      },
    },
  }
}

const workspaceDiffSchema: ToolSchema = {
  name: RUNTIME_WORKSPACE_TOOL_NAMES.diff,
  description:
    "Compute a diff between a workspace file's current content and a proposed next content, without persisting. Use it to preview a change before patching. Returns the diff between current and expected content, including whether content changed.",
  parameters: {
    type: "object",
    required: ["path", "expectedContent"],
    properties: {
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
  name: RUNTIME_WORKSPACE_TOOL_NAMES.move,
  description:
    "Move or rename a workspace file from one path to another. Use it only when a loaded Skill explicitly requires reorganizing runtime files. Returns the moved file paths. Returns an error if the source or target path is invalid. Both paths must sit under the same path-prefix area (e.g. both under save/).",
  parameters: {
    type: "object",
    required: ["path", "targetPath"],
    properties: {
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
  name: RUNTIME_WORKSPACE_TOOL_NAMES.delete,
  description:
    "Delete one or more workspace files matching a path prefix. Use it only when a loaded Skill explicitly requires removing runtime files. Returns the deleted file paths. Returns an error if the path is not deletable for the current Agent.",
  parameters: {
    type: "object",
    required: ["path"],
    properties: {
      path: {
        type: "string",
        description: "Target workspace file path (or prefix) to delete.",
      },
    },
  }
}

/**
 * Build the JSON Schema tool list for API-native function calling, gated by the
 * same Agent platform-tool enablement that the text-protocol prompt uses.
 *
 * `use_skill` and `run_script` are always available because Skill
 * installation/enablement is player/card-author controlled. `agent_call` is
 * gated by contacts + the `agent_call` platform tool. Workspace read tools are
 * gated by `workspace_read`; workspace write/delete/move tools by
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

  const schemas: ToolSchema[] = [useSkillSchema, runScriptSchema]

  if (canCallAgents) {
    schemas.push(agentCallSchema)
  }

  if (canReadWorkspace) {
    schemas.push(
      workspaceReadSchema,
      workspaceListSchema,
      workspaceSearchSchema,
      workspaceGlobSchema,
    )
  }

  if (canWriteWorkspace) {
    schemas.push(
      workspaceDiffSchema,
      workspaceWriteSchema,
      workspaceMoveSchema,
      workspaceDeleteSchema,
    )
  }

  const canInspectFrontend = platformToolEnabled(
    options.enabledPlatformTools,
    AGENT_PLATFORM_TOOL_NAMES.inspectFrontend,
  )
  if (canInspectFrontend) {
    schemas.push(inspectFrontendSchema)
  }

  return schemas
}
