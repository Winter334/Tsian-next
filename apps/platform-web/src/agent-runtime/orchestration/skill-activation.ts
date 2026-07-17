import type { AiChatMessage, RuntimeChatMessage } from "../../runtime-host/ai"
import {
  collectActivatedSkillContents,
  type ActivatedSkillContent,
  type RuntimeWorkspaceToolSessionState,
} from "../workspace-tools"
import type { WorkspaceFile } from "@tsian/contracts"

/**
 * Build the context message body for a skill whose full SKILL.md was activated
 * via use_skill. The framework injects this as a user message after the round's
 * tool observations so the model sees the skill text in the next round without
 * spending a tool-result round on it. Both tool loops (native and text) call
 * this via collectActivatedSkillContents + this body builder.
 *
 * Skill 是卡模板精心设计的可控内容，全文注入。截断会让 tsian-actions JSON
 * 块的 inputSchema 可能丢失——agent 不知道脚本参数，是难以察觉的问题。
 */
function formatActivatedSkillMessageBody(skill: ActivatedSkillContent): string {
  const header = `已激活 Skill「${skill.name}」。以下是该 Skill 的说明；遵循其指导，并用 run_script 执行其声明的 browser_script action。`
  return [header, "", skill.content].join("\n")
}

/**
 * Inject full SKILL.md content for skills newly activated via use_skill into
 * the native tool-loop message array. Called after the round's tool
 * observations are threaded back, before the next model call. Mutates
 * `messages` in place (native loop uses a mutable array).
 */
export function injectActivatedSkillMessagesNative(
  messages: RuntimeChatMessage[],
  sessionState: RuntimeWorkspaceToolSessionState | undefined,
  workspaceFiles: WorkspaceFile[],
): void {
  const contents = collectActivatedSkillContents(sessionState, workspaceFiles)
  for (const skill of contents) {
    messages.push({
      role: "user",
      content: formatActivatedSkillMessageBody(skill),
    })
  }
}

/**
 * Inject full SKILL.md content for skills newly activated via use_skill into
 * the text tool-loop message array. Returns a new array (text loop keeps an
 * immutable nextMessages style).
 */
export function injectActivatedSkillMessagesText(
  messages: AiChatMessage[],
  sessionState: RuntimeWorkspaceToolSessionState | undefined,
  workspaceFiles: WorkspaceFile[],
): AiChatMessage[] {
  const contents = collectActivatedSkillContents(sessionState, workspaceFiles)
  if (contents.length === 0) {
    return messages
  }
  const injected: AiChatMessage[] = contents.map((skill) => ({
    role: "user",
    content: formatActivatedSkillMessageBody(skill),
  }))
  return [...messages, ...injected]
}
