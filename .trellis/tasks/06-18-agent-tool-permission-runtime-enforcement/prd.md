# Agent Tool Permission Runtime Enforcement

## Goal

Make Studio's Agent tool and permission controls real: each Agent can have understandable tool availability and workspace permission settings, and Agent Runtime must enforce those settings during tool execution instead of only showing UI hints.

This follows up the Agent-centered Studio task, where Tools and 权限 were intentionally deferred because editable controls would have been misleading without runtime behavior.

## User Value

- Players can understand what an Agent is allowed to do without reading raw prompt/runtime code.
- Card authors can give different Agents different tool sets and workspace write authority.
- Runtime behavior matches Studio configuration, reducing surprising Agent actions.
- The UI stays moderate-density and player-friendly instead of exposing low-level implementation clutter.

## Confirmed Facts

- Runtime workspace tools currently include Skill loading, Skill action calls, Agent calls, and generic `workspace.*` operations.
- `workspace_operation` execution already has actor-level and exposed-operation gates in `workspace-operations.ts`.
- Agent `workspaceAccess.level` is already parsed from `AGENT.md`; missing or invalid values default to level `1`.
- `AgentRuntimeCapabilities` already accepts `actionExecutorPolicy`, `exposedWorkspaceOperations`, and `workspaceMutations`, but platform-host does not yet derive them from per-Agent Studio/card configuration.
- Runtime prompt instructions currently list a fixed set of tool examples instead of being generated from per-Agent tool availability.
- The previous Studio task explicitly deferred editable Tools/权限 controls until this runtime enforcement task.
- Skill action `workspace_operation` currently adds the declared operation into the exposed operation list for that action path; this is useful for action-local declarations but must be reconciled with any Agent-level disable/permission model.
- API/provider configuration is sensitive local configuration and should not be mixed into distributable game card content; this task is about Agent/card-side runtime permissions, not model provider settings.
- User decision: MVP controls only platform-provided tools. Skill-related entry points are allowed by default because players choose which Skills to install or create.
- User decision: introduce `agents/<agent>/agent.json` as the canonical Agent configuration file.
- User decision: prototype-stage breaking changes are acceptable; do not preserve old `AGENT.md` frontmatter configuration compatibility.
- User decision: `AGENT.md` remains required and acts as the Agent's SOP/instruction file; `agent.json` must not absorb prompt prose.
- User decision: Skill actions remain default-allowed, but any platform workspace side effects they trigger must obey the selected Agent's platform workspace permissions.

## Requirements

1. Add a real per-Agent configuration model for platform-provided runtime tools and workspace access.
2. Reuse existing mechanisms where possible:
   - `workspaceAccess.level` for workspace authority.
   - `exposedWorkspaceOperations` for allowed generic workspace operations.
   - `actionExecutorPolicy` for executor-class availability.
3. Add Studio controls only for behavior that Runtime actually enforces.
4. Keep the Studio UI Agent-centered and readable:
   - no fake controls;
   - no debug-only implementation jargon as the primary player-facing model;
   - no broad policy builder in the first slice.
5. Runtime prompt/tool instructions must reflect the selected Agent's effective tool availability.
6. Disabled tools must fail safely if an Agent still attempts the tool call.
7. Delegated `agent_call` execution must apply the target Agent's own tool/permission configuration, not only the root Agent's configuration.
8. Replace Agent metadata/frontmatter configuration with `agents/<agent>/agent.json`; Studio configuration writes must target this file.
9. Do not add account, remote trust, multi-card loading, or provider/API-key configuration changes in this task.
10. Skill loading and Skill action execution remain default-allowed in the MVP.
11. Skill actions that reach platform workspace operations or platform-controlled executors must still be reconciled with the effective Agent platform permissions, so Skills cannot silently bypass disabled platform capabilities.
12. Default workspace/card content must be updated to the new Agent layout without carrying old frontmatter fields forward.
13. `AGENT.md` remains a required Agent SOP/prompt file and should contain human/model-readable instructions, not machine configuration.

## Acceptance Criteria

- [ ] Studio exposes per-Agent platform tool/permission controls whose labels are understandable to players.
- [ ] Agent configuration persists in card/workspace metadata in a way that is exportable with the game card and readable without hidden local app state.
- [ ] Agent registry/discovery uses `agents/<agent>/agent.json` as the canonical configuration source.
- [ ] `AGENT.md` frontmatter is no longer required or used for configuration.
- [ ] Agent context assembly requires and includes `AGENT.md` as the SOP/instruction file.
- [ ] Runtime host derives capabilities from the active Agent configuration for master/narrative/delegated Agent steps.
- [ ] `skill_load` and `action_call` remain available by default and continue to respect Skill enablement/loading rules.
- [ ] `agent_call` and generic `workspace.*` calls are either allowed or denied according to the effective Agent configuration.
- [ ] Skill actions that invoke platform workspace operations or browser-script workspace SDK methods cannot bypass the selected Agent's platform workspace permissions.
- [ ] Workspace read/write/list/search/mutation operations continue to pass operation exposure and actor-level gates.
- [ ] Prompt tool instructions omit disabled tool categories and do not advertise capabilities the Agent cannot use.
- [ ] Attempts to use disabled tools produce structured tool errors/traces instead of silently succeeding.
- [ ] Built-in default cards are updated to include `agent.json` files and simplified `AGENT.md` prompt files.
- [ ] Tests or targeted validation cover registry parsing, capability derivation, runtime denial paths, and Studio persistence.

## Out Of Scope

- Fine-grained per-action or per-Skill trust UI.
- Full plugin/security sandbox model for third-party Skill authors.
- Per-Skill or per-action enablement beyond the existing Skill enable/disable UI.
- Disabling the Skill load/action entry points themselves.
- Provider/API-key/model configuration.
- Account sync or remote policy.
- Multi-card loading.
- Reworking Skill management beyond what is needed to enforce tool permissions.
- Backward compatibility for old Agent frontmatter configuration.

## Open Questions

- None.
