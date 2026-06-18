# Desktop Assistant App And Card Knowledge

## Goal

Design and implement a RetroOS desktop Assistant app that helps players understand and edit the currently loaded Game Card, while separating the player's familiar local assistant persona/configuration from Game Card-distributed knowledge.

The current direction revises an earlier assumption: the assistant should not always be fully owned by and replaced by each Game Card. Instead, the default Assistant app should keep a player-local assistant identity and preferences, then attach the loaded Game Card's knowledge base and optional card-provided assistant profile as context or an explicit selectable mode.

## User Value

- Players can keep using a familiar customized assistant across different Game Cards.
- Game Card authors can still distribute card-specific knowledge so the assistant understands that card's world, rules, editing conventions, and intended usage.
- Game Card authors may optionally distribute a card-specific assistant profile when the card benefits from a strongly authored guide/persona.
- Players can ask questions and get editing help without digging through raw workspace files first.
- The Assistant becomes a natural desktop application rather than another dense Studio panel.

## Confirmed Facts

- The current platform uses a RetroOS desktop shell with desktop applications and route-backed windows.
- Desktop apps such as Play, Studio, Assistant, and Game entrypoints use the currently loaded Game Card by default and should not each add their own ordinary card picker.
- The platform has one currently loaded Game Card stored separately from the active Save Instance.
- Game Card content owns reusable files such as Agents, Skills, rules, schemas, docs, assistant metadata, and optional frontend bindings.
- Save runtime data owns playthrough-specific data under `save/...`.
- Earlier task `06-14-workspace-assistant-agent-template` intentionally modeled the workspace assistant as ordinary Game Card/workspace content, not a hidden platform persona.
- The built-in blank Game Card currently declares `manifest.assistant.agentId = "studio-assistant"` and includes `agents/studio-assistant/*`, a `framework-knowledge` Skill, and `docs/tsian-framework-knowledge.md`.
- `GameCardManifest.assistant` currently only supports `{ agentId, summary? }`.
- Studio currently resolves assistant availability from the current card manifest and Agent registry.
- Recent Agent configuration work moved Agent machine-readable config to `agents/<agent>/agent.json`; `AGENT.md` is SOP/prompt prose.
- Current runtime Agent context already has a lowercase `notes.md` convention for mutable Agent notes under save-scoped Agent directories; the repository does not currently have a `MEMORY.md` file convention.
- Existing broader memory content is represented through workspace directories such as `save/memory/...`, not a per-Agent uppercase `MEMORY.md`.
- Runtime workspace operations and Agent platform tools are now gated by per-Agent permissions.
- User proposal for this task:
  - the default Assistant should be player-local and stable across Game Cards;
  - Game Cards should distribute knowledge bases, especially card-specific knowledge;
  - card-distributed assistant Agent/config should become optional rather than always replacing the player's assistant;
  - if a Game Card provides a dedicated assistant, the player should be able to choose it;
  - the desktop app can be shaped like the web Codex chat UI.
- User accepted that the first version should include a lightweight Assistant mode switch:
  - default mode: player's local Assistant plus current Game Card knowledge;
  - optional mode: current Game Card's dedicated Assistant, when the card declares one.
- The current storage model has three important boundaries:
  - Game Card `contentFiles` are distributable card content;
  - save `workspaceFiles` store only save runtime data mounted at `save/...` plus host-owned `.tsian/...`;
  - local AI provider/API configuration is browser-local and must not enter Game Card packages.
- Desktop Assistant self-improvement is more applicable than AIRP process-Agent memory because the Assistant directly interacts with the player and can learn preferences, editing habits, and recurring guidance corrections over time.
- User clarified that Assistant self-improvement should be automatic and mostly invisible, not a manual confirmation loop.
- User prefers integrating the local Assistant into the Workspace mental model because existing Agent tools, Skill actions, and editing/read flows are already workspace-oriented; a separate non-workspace tool stack would increase complexity and make the UX harder to understand.
- User proposed a `.tsian`-like Workspace directory for local-only data:
  - local Assistant files and future platform/player configuration could appear in one Workspace tree;
  - the directory would normally be excluded from Game Card packaging;
  - it would default to the highest permission level;
  - platform-local data could become visually manageable through the same resource-management mental model;
  - this likely implies a mount/soft-link concept so local data can appear in the effective Workspace without physically belonging to Game Card content or Save runtime data.
- Current `.tsian/*` is already `platform-meta` with read/edit level `4`, but existing save `.tsian` files such as traces are save/checkpoint-owned platform metadata. Player-local Assistant data should not accidentally follow Save checkpoint/restore semantics.
- User confirmed the first slice should only add the local Assistant mount under `.tsian/local/assistant/...`; migrating broader platform settings into `.tsian/local/settings/...` is deferred.
- User confirmed the first self-improvement writable file is a single `notes.md`; no `MEMORY.md` is introduced. Rationale: the repo already has a `notes.md` convention for per-agent mutable notes (`save/agents/<agent>/notes.md`), and `memory` in this project is a directory/system-level concept, not a per-agent filename. Keeping one file avoids a redundant two-name mental model.
- User confirmed `.tsian/` should remain a single top-level directory. Local-only data lives under `.tsian/local/` and is excluded from save checkpoint/restore by refining the checkpoint persistence filter (currently `isSaveRuntimePersistencePath` accepts all `.tsian/` paths; it must exclude `.tsian/local/`). No second top-level directory is introduced.
- User confirmed the Assistant knowledge mount model (Plan A): the Assistant agent declares a knowledge mount in `agent.json` (e.g. `knowledgeMount: "knowledge/"`) pointing to a distributable card-content directory. The Assistant treats this mounted directory as its own knowledge base: reads pull from the card-content source, writes sync back to the card-content source so new knowledge is distributable. Changing the loaded Game Card automatically swaps the mount source. The workspace operation layer resolves mount-point paths to real card-content paths. This replaces the earlier "two physical locations" approach and avoids a soft-link manager in the first slice.
- The Assistant self-improvement Skill writes to two targets: local personal notes at `.tsian/local/assistant/notes.md` (not distributable, not checkpointed) and distributable card knowledge via the knowledge mount (e.g. `agents/studio-assistant/knowledge/` resolved to card-content `knowledge/`).
- The knowledge mount source is the existing `docs/` card-content directory. No new `knowledge/` top-level card-content directory is introduced. The blank card already has `docs/tsian-framework-knowledge.md` and the assistant's `contextPaths` already references it. The assistant sees the mount as its own `knowledge/` directory; the real path is `docs/`.
- The workspace write tool is already a底层 platform tool in the agent runtime. An agent with `workspace_write` in its `platformTools.enabled` can call `workspace.patch` and related operations directly through the tool-call loop. There is no separate confirmation/preview UI layer in the runtime path; permission enforcement happens at the workspace-operations layer via actor level and scope access. The first Assistant chat can therefore support read and write from the start without building additional confirmation infrastructure.
- The first Assistant chat supports both read and write through the existing runtime tool loop. Destructive operations (deleting card content or save data) remain a product-policy safety boundary for a later autonomous-edit task, but ordinary reads, patches, and knowledge-mount writes are fully supported by the existing toolchain.

## Requirements

- Add a desktop Assistant app entry point/window in the RetroOS shell.
- The Assistant app must operate against the currently loaded Game Card by default.
- The default assistant identity/configuration should be platform-local/player-local, not blindly replaced when the loaded Game Card changes.
- Game Card-distributed knowledge must be discoverable and usable by the Assistant app after loading a Game Card.
- The Assistant app should be able to answer questions about the current Game Card, including card overview, workspace structure, available Agents/Skills, author docs, and editing guidance.
- The Assistant app should support the future concept of an optional card-specific assistant profile without making it the only assistant mode.
- The first Assistant UI should include a lightweight mode switch between the player-local assistant and an optional Game Card-specific assistant when available.
- The player-local assistant should be able to self-improve over time by preserving player preferences, repeated corrections, useful working habits, and durable notes.
- Self-improvement should be automatic and mostly invisible during normal chat.
- Self-improvement should be implemented through Skill/workspace mechanisms where possible, so the Assistant can maintain its own local files without requiring a separate tool stack.
- The local Assistant's persistent profile/memory should participate in the Workspace mental model while remaining local-only and excluded from Game Card packages and Save checkpoints.
- The local Assistant's personal notes live at `.tsian/local/assistant/notes.md` under a single `.tsian/local/` sub-directory. No `MEMORY.md` file is introduced.
- `.tsian/local/` must be excluded from save checkpoint/restore by refining the checkpoint persistence path filter. Existing save-owned `.tsian/traces`, `.tsian/checkpoints`, `.tsian/indexes`, `.tsian/cache` continue to be checkpointed; `.tsian/local/` does not.
- The Assistant agent declares a knowledge mount in `agent.json` (e.g. `knowledgeMount: "docs/"`) pointing to the existing `docs/` card-content directory. The workspace operation layer resolves mount-point reads and writes to the real `docs/` path so the Assistant can manage distributed knowledge as if it were its own `knowledge/` directory.
- Changing the loaded Game Card automatically swaps the knowledge mount source without requiring the player to reconfigure the Assistant.
- The Assistant self-improvement Skill maintains `.tsian/local/assistant/notes.md` for personal preferences/corrections/habits and writes distributable card knowledge through the knowledge mount.
- The likely direction is a local-only `.tsian/local/...` virtual mount inside the effective Workspace rather than storing player-local Assistant files in ordinary Game Card content or ordinary Save runtime files.
- Any `.tsian/local/...` local-data mount must be clearly separated from save-owned `.tsian/traces`, `.tsian/checkpoints`, `.tsian/indexes`, and `.tsian/cache` metadata.
- The first slice should hardcode one local Assistant mount instead of introducing a general mount manager or migrating platform settings.
- The first UI should be chat-first and approachable, similar in spirit to web Codex: conversation in the main area, with current-card context and referenced files/actions as supporting UI.
- The first Assistant chat supports both read and write through the existing agent runtime tool loop (`workspace_read`, `workspace_write`, `workspace.patch`, etc.). No additional confirmation UI is needed for ordinary reads and patches.
- Keep information density moderate; avoid turning the Assistant into a debug console or a second Studio.
- Assistant edits or destructive actions must not happen silently. Editing help may propose or stage changes, but user confirmation remains required unless a later task explicitly designs autonomous edits.
- Sensitive local AI provider/API configuration remains local platform configuration and must not be written into Game Cards or packages.
- Keep the first implementation compatible with the current Game Card package import/export model.

## Acceptance Criteria

- [ ] A Desktop Assistant app is available from the RetroOS desktop shell.
- [ ] The Assistant app uses the currently loaded Game Card without asking the user to pick a card again.
- [ ] The default assistant can persist player-local identity/preferences across Game Card changes.
- [ ] The Assistant can access current-card knowledge files and card metadata as context.
- [ ] The UI clearly indicates the current card context without adding a noisy desktop-wide status banner.
- [ ] If the current Game Card declares an assistant, the UI can surface it as an optional card-specific assistant mode or entry.
- [ ] The default mode remains the player-local Assistant plus current-card knowledge, even when a card-specific Assistant exists.
- [ ] The player-local Assistant has a local persistence model for identity/preferences and self-improvement notes.
- [ ] The player-local Assistant can automatically update its own local memory/profile through a Skill or equivalent runtime workspace flow.
- [ ] The local Assistant's persistent files are readable/editable through workspace-style primitives rather than a bespoke assistant-only storage UI.
- [ ] `.tsian/local/` paths are excluded from save checkpoint/restore while existing `.tsian/traces|checkpoints|indexes|cache` remain checkpointed.
- [ ] The Assistant agent has a declared knowledge mount in `agent.json` pointing to `docs/`; reads and writes through the mount point resolve to the current Game Card's `docs/` directory.
- [ ] Changing the loaded Game Card swaps the knowledge mount content without Assistant reconfiguration.
- [ ] The self-improvement Skill writes personal notes to `.tsian/local/assistant/notes.md` and distributable knowledge through the mount; no `MEMORY.md` file is created.
- [ ] Local Assistant files are excluded from Game Card package import/export and Save checkpoint/restore by default.
- [ ] Local Assistant files can still appear in a Workspace/resource-manager mental model, likely through a local-only virtual mount under a reserved high-permission directory.
- [ ] The first implementation does not expose provider/platform settings files under `.tsian/local/settings/...`.
- [ ] The Assistant chat can answer at least basic current-card questions from manifest, docs, Agent/Skill registry, and relevant workspace files.
- [ ] The Assistant chat can perform workspace reads and writes through the existing runtime tool loop without a bespoke confirmation UI.
- [ ] The implementation does not leak local provider/API configuration into Game Card content, packages, bridge payloads, or visible debug summaries.
- [ ] Empty states are handled for no loaded card, no active save, and cards without assistant metadata or knowledge files.
- [ ] `npm run build:web` passes.
- [ ] Additional contract builds run if shared contract shapes change.

## Out Of Scope

- Account sync or cloud-stored assistant identity.
- Multi-card simultaneous assistant context.
- Autonomous edits to current Game Card content or Save runtime data without explicit confirmation.
- Full marketplace/distribution policy for third-party assistant profiles.
- Final polished long-term memory or account-sync system for the player-local assistant.
- Rebuilding Studio Agent/Skill management in this Assistant task.
- Reworking AI provider/model preset storage.
- Migrating Settings or API provider configuration into `.tsian/local/settings/...`.
- A generalized workspace mount/soft-link manager beyond the Assistant knowledge mount.
- Introducing a `MEMORY.md` file; self-improvement uses `notes.md` only.
- A second top-level directory for local data; local data stays under `.tsian/local/`.

## Open Questions

_(None remaining. All planning questions resolved.)_
