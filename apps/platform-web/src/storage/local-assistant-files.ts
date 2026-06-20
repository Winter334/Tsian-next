import type { AgentConfig, WorkspaceFile } from "@tsian/contracts"
import { localDb } from "./db"

const LOCAL_ASSISTANT_FILES_KEY = "assistant-local-files"

const LOCAL_ASSISTANT_DIR = ".tsian/local/assistant"

export const LOCAL_ASSISTANT_AGENT_ID = "assistant"

interface StoredAssistantFile {
  content: string
  mediaType: string
}

interface StoredAssistantFileMap {
  [path: string]: StoredAssistantFile
}

const DEFAULT_AGENT_MD = [
  "# Desktop Assistant",
  "",
  "This SOP helps you answer questions about the current game card and workspace.",
  "Keep durable identity and work style in `SOUL.md`.",
  "Read relevant workspace docs and Skill instructions before giving framework or maintenance advice.",
  "",
  "## Knowledge Base",
  "",
  "Your `knowledge/` directory is a mount to the current game card's `docs/` directory.",
  "Files you read and write there are distributable card knowledge.",
  "When you learn something useful about this card that other players' assistants would benefit from, write it to your knowledge base.",
  "",
  "## Self-Improvement",
  "",
  "Your personal notes live at `notes.md` in this directory.",
  "When the player corrects you, shares a preference, or you notice a recurring pattern, append a concise note there.",
  "These notes are local to this player and do not distribute with the game card.",
  "",
].join("\n")

const DEFAULT_SOUL_MD = [
  "# Desktop Assistant Soul",
  "",
  "You are the player's personal desktop assistant.",
  "Help players and authors understand the Tsian framework, inspect workspace conventions, and plan safe changes to Agents, Skills, state files, frontend data, memory, diagnostics, and game-card content.",
  "",
  "When the user asks framework, authoring, workspace, or diagnostics questions, load the `framework-knowledge` Skill before giving a confident answer.",
  "Treat current workspace files as the source of truth. Read local README files, schemas, Agent definitions, Skill definitions, and diagnostics when the answer depends on local content.",
  "",
  "Do not claim hidden platform powers. You can only use the tools, bridge APIs, or future UI actions explicitly made available to you.",
  "Do not edit files unless the current UI/tooling asks you to perform or prepare a concrete change.",
  "",
].join("\n")

const DEFAULT_FRAMEWORK_KNOWLEDGE_SKILL_MD = [
  "---",
  "name: framework-knowledge",
  "title: Framework Knowledge",
  "description: Consult the official Tsian framework knowledge base and local workspace conventions before answering authoring, diagnostics, or workspace-management questions.",
  "triggers:",
  "  - The user asks how Tsian, Game Cards, Save Instances, checkpoints, Runtime Workspace, Agents, Skills, frontend bridge, traces, or diagnostics work",
  "  - The user asks how to edit, fix, or design workspace files",
  "  - The assistant is unsure whether an answer depends on platform or workspace conventions",
  "appliesTo:",
  "  - assistant",
  "---",
  "",
  "# Framework Knowledge",
  "",
  "Use this Skill when answering questions about Tsian framework behavior, workspace layout, game-card authoring, diagnostics, or maintenance decisions.",
  "",
  "Procedure:",
  "",
  "1. Read `docs/tsian-framework-knowledge.md` first. If the question uses terms you cannot find directly, search the workspace for those terms.",
  "2. If the answer depends on local content, inspect the relevant files before answering. Common files include `README.md`, `agents/README.md`, `skills/README.md`, `state/README.md`, `frontend/README.md`, Agent `AGENT.md` files, Skill `SKILL.md` files, and schemas near the data being discussed.",
  "3. Answer from workspace facts. Mention the specific files or conventions you relied on when that helps the user verify the answer.",
  "4. If the knowledge base is incomplete or the requested behavior is future work, say that clearly and separate current facts from suggestions.",
  "",
  "This Skill declares no actions. It uses ordinary workspace read, list, and search tools.",
  "",
].join("\n")

function defaultAssistantConfig(): AgentConfig {
  return {
    id: LOCAL_ASSISTANT_AGENT_ID,
    title: "Desktop Assistant",
    summary: "Helps players understand and edit the current game card.",
    contacts: [],
    contextPaths: [],
    skills: {
      enabled: ["framework-knowledge"],
      disabled: [],
    },
    platformTools: {
      enabled: ["agent_call", "workspace_read", "workspace_write"],
      disabled: [],
    },
    workspaceAccess: {
      level: 4,
    },
    knowledgeMount: "docs/",
  }
}

function defaultLocalAssistantFileMap(): StoredAssistantFileMap {
  const now = Date.now()
  void now
  const config = defaultAssistantConfig()
  return {
    [`${LOCAL_ASSISTANT_DIR}/agent.json`]: {
      content: JSON.stringify(config, null, 2) + "\n",
      mediaType: "application/json",
    },
    [`${LOCAL_ASSISTANT_DIR}/AGENT.md`]: {
      content: DEFAULT_AGENT_MD,
      mediaType: "text/markdown",
    },
    [`${LOCAL_ASSISTANT_DIR}/SOUL.md`]: {
      content: DEFAULT_SOUL_MD,
      mediaType: "text/markdown",
    },
    [`${LOCAL_ASSISTANT_DIR}/notes.md`]: {
      content: "# Assistant Notes\n\n",
      mediaType: "text/markdown",
    },
    [`${LOCAL_ASSISTANT_DIR}/skills/framework-knowledge/SKILL.md`]: {
      content: DEFAULT_FRAMEWORK_KNOWLEDGE_SKILL_MD,
      mediaType: "text/markdown",
    },
  }
}

/** Load local assistant files from the Dexie meta store, seeding defaults if absent. */
export async function loadLocalAssistantFiles(): Promise<WorkspaceFile[]> {
  const record = await localDb.meta.get(LOCAL_ASSISTANT_FILES_KEY)
  if (record?.value) {
    try {
      const parsed = JSON.parse(record.value) as StoredAssistantFileMap
      if (parsed && typeof parsed === "object") {
        return Object.entries(parsed).map(([path, file]) => ({
          path,
          content: file.content,
          mediaType: file.mediaType,
          createdAt: 0,
          updatedAt: 0,
        }))
      }
    } catch {
      // Fall through to seeding.
    }
  }

  // Seed defaults and persist.
  const map = defaultLocalAssistantFileMap()
  await localDb.meta.put({
    key: LOCAL_ASSISTANT_FILES_KEY,
    value: JSON.stringify(map),
  })
  return Object.entries(map).map(([path, file]) => ({
    path,
    content: file.content,
    mediaType: file.mediaType,
    createdAt: 0,
    updatedAt: 0,
  }))
}

/** Persist local assistant files back to the Dexie meta store. */
export async function saveLocalAssistantFiles(files: WorkspaceFile[]): Promise<void> {
  const map: StoredAssistantFileMap = {}
  for (const file of files) {
    if (!file.path.startsWith(`${LOCAL_ASSISTANT_DIR}/`)) {
      continue
    }
    map[file.path] = {
      content: file.content,
      mediaType: file.mediaType,
    }
  }
  // Merge with existing stored files so we don't drop anything not in this batch.
  const record = await localDb.meta.get(LOCAL_ASSISTANT_FILES_KEY)
  if (record?.value) {
    try {
      const existing = JSON.parse(record.value) as StoredAssistantFileMap
      if (existing && typeof existing === "object") {
        for (const [path, file] of Object.entries(existing)) {
          if (!(path in map)) {
            map[path] = file
          }
        }
      }
    } catch {
      // Ignore; we'll overwrite with the merged map.
    }
  }
  await localDb.meta.put({
    key: LOCAL_ASSISTANT_FILES_KEY,
    value: JSON.stringify(map),
  })
}

/** Check whether a path belongs to the local assistant directory. */
export function isLocalAssistantPath(path: string): boolean {
  return path === LOCAL_ASSISTANT_DIR || path.startsWith(`${LOCAL_ASSISTANT_DIR}/`)
}

/**
 * 助手会话 context 快照的虚拟文件路径(design 06-20-assistant-context-persistence).
 * 存本模块 Dexie map 的一项,对外暴露为虚拟文件——agent 可 workspace_read/write 管理,
 * 契合"平台数据收录到文件系统"的产品哲学.每会话独立路径,切换会话不串上下文.
 */
export function assistantContextPath(sessionId: string): string {
  return `${LOCAL_ASSISTANT_DIR}/sessions/${sessionId}/context.json`
}

/**
 * 从 local-assistant-files map 删除单个文件(供会话删除清理 context 快照).
 * saveLocalAssistantFiles 是合并模式(只合并不删项),故需此专用删除函数.
 * 只处理 .tsian/local/assistant/ 前缀路径(安全边界),非该前缀忽略.
 */
export async function deleteLocalAssistantFile(path: string): Promise<void> {
  if (!isLocalAssistantPath(path)) {
    return
  }
  const record = await localDb.meta.get(LOCAL_ASSISTANT_FILES_KEY)
  if (!record?.value) {
    return
  }
  try {
    const map = JSON.parse(record.value) as StoredAssistantFileMap
    if (!map || typeof map !== "object" || !(path in map)) {
      return
    }
    delete map[path]
    await localDb.meta.put({
      key: LOCAL_ASSISTANT_FILES_KEY,
      value: JSON.stringify(map),
    })
  } catch {
    // 损坏 map 忽略,不阻塞会话删除
  }
}
