# Implementation Plan

## Preconditions

- User reviewed and approved moving from planning to implementation on 2026-06-18.
- Review this PRD/design/implementation plan before running `task.py start`.

## Steps

1. Contracts and Agent JSON model
   - Add contract types for `AgentConfig`, `AgentPlatformToolName`, and platform tool configuration if useful.
   - Extend `AgentRegistryEntry` with config-derived platform tools and workspace access fields.
   - Decide the exact relationship between `AgentRegistryEntry.path`, `agent.json`, and `AGENT.md` paths.

2. Registry and context assembly
   - Change Agent discovery from `agents/<agent>/AGENT.md` to `agents/<agent>/agent.json`.
   - Parse Agent title, summary, contacts, context paths, Skill enablement, platform tools, and workspace access from JSON.
   - Require and attach `AGENT.md` as the Agent SOP/prompt file.
   - Attach optional `SOUL.md` as identity/style prompt context.
   - Remove frontmatter parsing as the Agent configuration source.

3. Default workspace/card content
   - Add `agent.json` files for built-in Agents.
   - Simplify built-in `AGENT.md` files by removing metadata frontmatter.
   - Update workspace/framework docs that describe Agent layout.
   - Update any path comments, diagnostics, or README text that treats `AGENT.md` as the registry definition.

4. Permission derivation helpers
   - Add pure helpers for default platform tool permissions.
   - Derive effective platform tool group enablement from `agent.json`.
   - Map `workspace_read` to list/search/read.
   - Map `workspace_write` to diff/patch/write/move/delete/validate.
   - Derive workspace actor level from `agent.json.workspaceAccess.level`.
   - Build an `actionExecutorPolicy` wrapper that can deny platform-controlled executor classes when required.

5. Runtime prompt shaping
   - Extend workspace tool instruction options with effective tool permissions.
   - Omit disabled platform tool examples.
   - Keep `skill_load` and `action_call` documented by default.

6. Runtime hard gates
   - Deny `agent_call` when the effective Agent profile disables it.
   - Deny generic workspace operations when their group is disabled.
   - Preserve existing exposed-operation and actor-level checks.
   - Reconcile Skill `workspace_operation` and browser script SDK workspace methods with the effective Agent workspace permissions.

7. Platform-host integration
   - Derive runtime capabilities per selected Agent before master/narrative calls.
   - Ensure delegated `agent_call` uses the target Agent's own effective permission profile.
   - Keep model/provider configuration local and unrelated.

8. Studio API
   - Replace Skill toggle writes from `AGENT.md` frontmatter updates to `agent.json` updates.
   - Add platform-host functions to update selected Agent platform tool fields and workspace access level.
   - Preserve unrelated JSON fields on read/modify/write.
   - Refresh Studio snapshot after mutation.

9. Studio UI
   - Add a Tools/Permissions section to `StudioView.vue`.
   - Show only player-friendly groups: Agent collaboration, workspace reading, workspace changes, workspace authority level.
   - Keep Skill controls in the existing Skills section.
   - Avoid exposing low-level executor names in the main UI.

10. Tests and validation
    - Add unit coverage for `agent.json` registry parsing and effective permission derivation.
    - Add runtime tests for disabled `agent_call` and disabled workspace operation paths.
    - Add a test or targeted validation for Skill workspace actions not bypassing workspace permissions.
    - Run `npm run build:contracts` if contracts change.
    - Run `npm run build:web`.

## Risk Points

- This intentionally breaks old Agent frontmatter configuration.
- Agent path semantics are used by diagnostics and session transcript helpers; update them carefully.
- Prompt shaping and execution gates must stay in sync.
- JSON edits must preserve unrelated Agent config fields.
- Browser script SDK workspace operations are a separate path from generic `workspace.*` tool calls.

## Rollback

- Restore Agent discovery from `AGENT.md`.
- Restore Studio Skill toggle frontmatter writes.
- Remove `agent.json` default content and parsing.
- Remove Studio tool/permission section and platform-host update APIs.
- Restore prior runtime instruction generation and capability injection.
