# Unify Agent Runtime Entry Pipeline

## Goal

Remove the hardcoded master->narrative two-step pipeline from `runAgentRuntimeTurn` and replace it with a single unified entry-agent runtime function. Both AIRP play turns and Assistant chat turns should use the same execution path: specify an entry agent ID, run that agent with workspace tools, and let it dynamically orchestrate other agents through `agent_call` as directed by its AGENT.md/SOUL.md and `agent.json` contacts configuration.

## User Value

- The platform no longer forces a specific agent execution sequence. Agent orchestration is driven by agent configuration and instructions, not hardcoded in the runtime.
- Play turn and Assistant chat share one code path, reducing duplication and maintenance burden.
- Game card authors can design their own agent flow by configuring contacts and AGENT.md instructions, without platform changes.

## Confirmed Facts

- `runAgentRuntimeTurn` currently hardcodes a two-step pipeline: first calls `master` agent to produce a brief, then calls `narrative` agent to produce the player-facing reply. The agent IDs `"master"` and `"narrative"` are hardcoded in `getWorkspaceAgentContext`.
- `masterPlan` is only used internally (passed from master to narrative); the platform-host caller only uses `result.replyText` and `result.agentSessionTranscripts`.
- Master's SOUL.md already says "You are the entry agent for an AIRP turn" and its AGENT.md says "write a concise brief for the narrative agent" - the design intent was always entry-agent-driven orchestration.
- Master's contacts are `["memory"]`; narrative's contacts are `["master"]`. For master to call narrative through agent_call, narrative must be added to master's contacts.
- `runAssistantAgentTurn` already implements the unified pattern: takes an `agentId`, runs a single agent with workspace tools, returns `replyText` + `agentSessionTranscripts`.
- `callAgentModelWithWorkspaceTools` is the shared tool-loop function used by both paths; it already supports agent_call delegation.
- `AgentSessionTranscriptRole` is `"master" | "narrative" | "delegated"`; the role mapping uses debugLabel string matching. This needs to become generic.
- The `MASTER_AGENT_PLATFORM_GUARD` and `NARRATIVE_AGENT_PLATFORM_GUARD` are hardcoded system prompt guards specific to the two-step flow. A unified function needs a generic guard or no hardcoded role-specific guard.
- `LEGACY_MASTER_AGENT_SYSTEM_PROMPT` and `LEGACY_NARRATIVE_AGENT_SYSTEM_PROMPT` are fallbacks for when no workspace agent context is found; these are legacy MVP artifacts.

## Requirements

- Replace `runAgentRuntimeTurn` and `runAssistantAgentTurn` with a single unified function that accepts an entry agent ID and runs that agent with workspace tools.
- The unified function returns `replyText` and `agentSessionTranscripts`; `masterPlan` is removed from the result type.
- The entry agent's AGENT.md, SOUL.md, contacts, and platform tools drive orchestration. The platform does not inject role-specific guards or force a second agent step.
- Platform-host's play turn (`interaction.sendMessage`) calls the unified function with the play turn entry agent ID.
- Platform-host's assistant chat (`runAssistantChat`) calls the same unified function with the assistant agent ID.
- The play turn entry agent ID should be configurable (default: `"master"` for existing cards).
- Master agent's AGENT.md and SOUL.md should be updated to reflect that it is now the sole entry agent that directly produces the player-facing reply, using agent_call to contact narrative and other specialist agents as needed.
- Master agent's contacts should include `narrative` so it can call narrative through agent_call.
- `AgentSessionTranscriptRole` should become generic (e.g. `"entry" | "delegated"`) instead of hardcoded role names.
- Legacy system prompts (`LEGACY_MASTER_AGENT_SYSTEM_PROMPT`, `LEGACY_NARRATIVE_AGENT_SYSTEM_PROMPT`) should be removed since the unified path always requires a workspace agent context.
- `AgentRuntimeTurnResult.masterPlan` field is removed.

## Acceptance Criteria

- [ ] A single unified runtime function handles both play turns and assistant chat.
- [ ] The function accepts an entry agent ID parameter.
- [ ] No hardcoded agent IDs (`"master"`, `"narrative"`) in the runtime function itself.
- [ ] Play turns produce the same quality of player-facing replies as before.
- [ ] Master agent can contact narrative and memory through agent_call.
- [ ] `masterPlan` is removed from the runtime result type.
- [ ] `AgentSessionTranscriptRole` uses generic role names.
- [ ] Legacy fallback prompts are removed.
- [ ] `npm run build:contracts` passes.
- [ ] `npm run build:web` passes.

## Out Of Scope

- Making the play turn entry agent configurable through GameCardManifest (can be a follow-up; first version hardcodes "master" as default at the platform-host call site).
- Removing the master and narrative agent definitions from the blank card template (they remain as workspace content).
- Changing the agent_call tool protocol or collaboration policy.
- Redesigning the AIRP turn flow beyond removing the hardcoded pipeline.

## Open Questions

_(None remaining.)_
