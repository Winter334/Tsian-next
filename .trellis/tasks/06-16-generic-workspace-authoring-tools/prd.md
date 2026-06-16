# Generic Workspace Authoring Tools

## Goal

Replace the current hard-scoped runtime workspace tools with a generic lightweight IDE-like workspace tool system that Studio UI, authoring Agents, and runtime Agents can use to inspect, search, diff, patch, and edit workspace scopes without hardcoding current Agent/Skill directory structures into the tool design.

## Parent

- `.trellis/tasks/06-15-platform-ui-development-phase`

## User Value

- Runtime, authoring, and studio Agents get one practical tool system closer to a small IDE instead of multiple hardcoded workspace tool surfaces.
- Workspace Studio UI and authoring Agents can share one tool/backend surface, so manual edits and Agent-assisted edits follow the same validation and diff flow.
- The tool layer stays useful if current content conventions such as `agents/`, `skills/`, or schema formats evolve.
- The platform can later add richer access policy without redesigning every authoring tool.
- Hard operation bounds come from explicit scope plus read/edit levels; soft behavioral bounds come from Agent instructions, Skill instructions, and UI mode.

## Confirmed Facts

- Runtime Agent tools currently include `workspace_read`, `workspace_list`, `workspace_search`, `skill_load`, `action_call`, and `agent_call`.
- Runtime write/delete actions currently target save runtime data under `save/...`; card content is intentionally separate.
- The user wants the new tool system to replace the old runtime workspace tools rather than coexist indefinitely, because the new system can cover old read/list/search/write/delete behavior with a more general scope and level model.
- Game Card content owns definitions such as Agents, Skills, docs, schemas, rules, world canon, and frontend-facing definitions.
- Save runtime data owns playthrough state under `save/...`.
- `.tsian/...` is platform metadata and should not be an ordinary edit target by default.
- The user wants generic capabilities, not tools named after transient content structures such as Agent or Skill editing.
- The user wants lightweight read/edit levels rather than fine-grained per-Agent directory ACLs.
- Access levels are a workspace collaboration convention, not a strong security boundary. Agents may edit their own `AGENT.md`, including level fields, when the player/studio flow allows it.
- Real safety for MVP should come from diff preview, player confirmation, checkpoint/rollback, and operation records, not from a complex permission system.
- Prototype development allows breaking changes. The old runtime workspace tool names do not need compatibility aliases if replacing them directly keeps the architecture cleaner.
- Tool exposure should be selectable. A given Agent, Skill, UI mode, or runtime context should be able to receive only a subset of the generic operations instead of always receiving the complete tool suite.
- The user approves Skill action exposure: a loaded Skill may expose a narrow semantic action backed by a generic workspace operation, while still going through operation exposure and read/edit level checks.

## Requirements

- Add a generic workspace capability model with stable operations:
  - list/browse;
  - search;
  - read;
  - diff preview;
  - patch;
  - write/create;
  - move/rename;
  - delete;
  - validate.
- Operations must target an explicit workspace scope:
  - `card-content` for Game Card content files;
  - `save-runtime` for active save runtime files;
  - `platform-meta` for `.tsian/...` platform metadata, defaulting to the highest level.
- New workspace tools must cover the old runtime workspace tool capabilities:
  - old `workspace_read` -> generic read with an explicit scope/effective-view mode;
  - old `workspace_list` -> generic list;
  - old `workspace_search` -> generic search;
  - old `workspace-write` -> generic write/patch scoped to `save-runtime` for ordinary runtime Agents;
  - old `workspace-delete` -> generic delete scoped to `save-runtime` for ordinary runtime Agents.
- Replace old runtime workspace tool names directly in the first implementation. Do not add compatibility aliases unless implementation reveals an unavoidable bootstrap problem.
- Add a lightweight operation exposure model:
  - tool execution must reject operations not exposed to the current Agent/mode/Skill context;
  - exposure controls which operations the Agent can call;
  - read/edit levels still control which targets those operations may affect.
- Support Skill action wrappers around generic workspace operations:
  - a Skill may declare an action whose executor calls a generic operation such as read, patch, write, or validate;
  - the Skill action should narrow operation, scope, path, schema, or intent compared with exposing the raw operation directly;
  - the wrapped operation must still pass operation exposure and read/edit level checks.
- Support separate read and edit levels with a simple rule:
  - actor can read when `actor.level >= target.readLevel`;
  - actor can edit when `actor.level >= target.editLevel`.
- Support inherited file/directory access levels:
  - defaults per scope;
  - optional path overrides;
  - longest matching path wins.
- Store an Agent's default workspace access level in that Agent's `AGENT.md` frontmatter, preferably under `workspaceAccess.level`.
- Treat missing Agent access level as the ordinary runtime default.
- Keep the level model lightweight:
  - no agent-specific directory ACL table;
  - no trust prompt framework;
  - no Settings UI in the first slice;
  - no attempt to prevent self-editing or self-level changes.
- Authoring writes should prefer patch/diff workflows where practical instead of blind full-file replacement.
- Ordinary runtime play should use the same generic tools, with the actor level/scope defaults limiting it to the intended runtime surface.
- Card-content editing is not blocked by a separate tool family; it is enabled by selecting `card-content` and having sufficient edit level.
- Tool code must not hardcode specific editable directories or current content structures. Directory- or file-specific behavior belongs in access metadata, Agent/Skill instructions, validators, or UI affordances.
- Tool availability may be declared as operation names or profiles, but the operations themselves remain generic.
- Validation must be pluggable or at least shaped for pluggability so current Agent/Skill/frontmatter checks do not become hardcoded into the generic tool layer.

## Acceptance Criteria

- [x] Planning records the generic tool operations and avoids Agent/Skill-specific tool names as the foundation.
- [x] Planning defines scopes, path normalization, read/edit level resolution, and default levels.
- [x] Planning defines where Agent default levels live and the expected behavior for missing levels.
- [x] Planning states that access levels are collaboration semantics, not strong security.
- [x] Planning defines how `.tsian/...` fits into the same level model.
- [x] Planning defines how diff/patch/write/delete/move should behave at boundaries.
- [x] Planning identifies existing runtime workspace tools and how they migrate onto the new generic tool system.
- [x] Planning records that prototype implementation may make breaking tool-name changes and does not require compatibility aliases.
- [x] Planning defines how a caller receives only an exposed subset of operations.
- [x] Planning distinguishes hard scope/level enforcement from soft Agent/Skill/UI guidance.
- [x] Planning defines MVP exclusions such as ACL UI, per-Agent directory policies, and full security hardening.

## Out Of Scope

- Full Workspace Studio UI implementation.
- Full Agent/Skill Studio implementation.
- Account, cloud, multiplayer, publishing, or cross-device authorization.
- Fine-grained ACLs binding individual Agents to directory lists.
- Preventing self-editing or self-level changes as a security boundary.
- Version-control-grade merge conflict handling.
- Strong isolation from malicious card content.

## Open Questions

- None.

## Resolved Questions

- Operation exposure can come from all three layers, with clear precedence. Platform/UI mode sets the outer tool profile, `AGENT.md` can narrow or request the Agent's default exposed operations, and loaded Skills can expose specific edit operations through their action declarations.
- Skill action exposure is allowed: a Skill can wrap a generic workspace operation as a narrower semantic action, but it does not bypass operation exposure or read/edit level checks.
