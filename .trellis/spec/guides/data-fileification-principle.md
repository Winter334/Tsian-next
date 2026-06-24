# Data Fileification Principle

> **Purpose**: Decide where new configurable data should live — file system or private DB field — before writing storage code.

---

## The Principle

**All configurable project data should be collectable into the workspace file system and manageable by the assistant agent through existing workspace tools.**

This is a product philosophy, not a performance rule. It extends Tsian's own tenet — "Gameplay-specific behavior belongs in Skills and workspace conventions" — to platform data: if a piece of data is something a user or agent could legitimately want to read, edit, or reason about, it should appear as a file the agent can see via `workspace_read` / `workspace_list` / `workspace_write`, not as an invisible DB column or private Dexie key.

---

## Why This Matters

The assistant agent can only manage what the file system exposes. Every piece of data hidden in a private DB field is a piece of data the agent cannot read or edit — which means the user cannot manage it through the assistant, which means it needs a bespoke UI instead.

History has already shown this principle driving real decisions:

- **Assistant context snapshot** (`06-20-assistant-context-persistence`): stored as a virtual file `.tsian/local/assistant/sessions/<sessionId>/context.json` in the `local-assistant-files` Dexie map, **not** as a separate Dexie key. The explicit reason: storing it in an invisible KV "breaks file-system visibility philosophy" — the agent must be able to `workspace_read` its own context.
- **Game card content files** (`06-21-content-files-per-file-table`): migrating `contentFiles` from an in-row array to a per-file table, so each content file is a first-class file with its own path, not a row-embedded blob.
- **Game card manifest** (`06-21-game-card-data-fileification`): manifest will be synthesized as `game-card.json` at the card root, so `name`/`summary`/`author`/`cover`/`frontend` become editable through the workspace instead of only through dedicated metadata forms.
- **Agent identity** (`agent.json` / `SOUL.md` / `AGENT.md`): already files, already agent-managed.

The common shape: data that *could* have been a DB field was made a file, so the agent's existing tools can manage it and no new tool is needed.

### Visible = Editable = Manageable

A stronger corollary, stated by the project owner:

> "If a path is visible in the resource manager, the user can edit it, and the desktop assistant can manage it (including its own definition). The assistant is the user's right hand, with near-player authority."

This binds three properties together — **resource-manager visibility ⇒ human editability ⇒ assistant manageability** — and eliminates the "visible but the assistant cannot touch it" gray zone. Practical consequences:

- The desktop assistant's actor level is the **highest** (default `4`), resolved from its own `agent.json` so it can manage every visible scope (`card-content`, `save-runtime`, `platform-meta`).
- The assistant can edit its own definition (`.tsian/local/assistant/agent.json` and identity files) — self-management is in scope, not a privileged host-only operation.
- Runtime game agents (agents defined in a card's `agents/`, running during a play turn) are a different, lower-trust actor class: they can only write `save/...` during a turn, never card content. Do not confuse the two.
- A hardcoded `actorLevel` on the assistant path breaks this principle by silently overriding the configured level — always resolve it live (see `type-safety.md` → Workspace Scope & Save Runtime Boundary).

The common shape: data that *could* have been a DB field was made a file, so the agent's existing tools can manage it and no new tool is needed.

---

## Before Adding New Configurable Data

### Step 1: Classify the data

Ask which bucket the new data falls into:

| Bucket | Should it be a file? | Examples |
|--------|----------------------|----------|
| **User/agent-configurable content** | ✅ Yes — file in the workspace | card content, agent identity, skills, manifest fields |
| **Agent-reasonable runtime state** | ✅ Yes — virtual file, agent-visible | assistant context snapshot, master context |
| **Internal bookkeeping** | ❌ No — DB field is fine | primary keys, `createdAt`/`updatedAt` timestamps, `source` flags, table indexes |
| **Binary blobs unsuitable for text editing** | ⚠️ Known exception — see below | cover image bytes |

If the data lands in the first two rows, it should be a file. If you find yourself reaching for a new Dexie key or a new column on an existing record for data in those rows, stop and reconsider.

### Step 2: Make it agent-visible

A "file" here means **a path the workspace tools can resolve**, not just a record in a table. Concretely:

- It must appear in the result of `listLocalGameCardContentFiles` / `listLocalAssistantFiles` / the relevant volume's `enumerate`.
- It must be reachable by `workspace_read` / `workspace_write` through the scope routing (card-content / save-runtime / platform-meta / card-frontend).
- It must have a stable, documented path the agent can be told about (e.g. `world/canon.md`, `.tsian/local/assistant/sessions/<id>/context.json`, `game-card.json`).

A record stored in Dexie but never surfaced through workspace enumeration is **not** fileified — it's a hidden DB field with extra steps.

### Step 3: Check the tool surface

The goal is that the assistant manages this data through **existing** tools (`workspace_read` / `workspace_write` / `use_skill` / `run_script`), not a new tool. If making the data a file means the agent can now read/write it with existing tools, the principle is satisfied. If you're adding a new tool to manage the new file, ask whether the file shape is right — the tool surface should stay stable; capability is defined by *which files are visible*, not by *how many tools exist*.

---

## Known Exceptions (Don't Pretend They Don't Exist)

- **Cover image bytes** (`.cover/cover.<ext>` as base64 data-URI): currently stored as a content file but **not** practically editable as text — a data-URI is not human-editable. Cover images still go through the upload UI. Registered as a known limitation in `06-21-game-card-data-fileification` B3. If binary content support is added later, this exception can be retired.
- **Timestamps, primary keys, source flags, schema markers**: internal bookkeeping. These stay as DB fields. `game-card.json` enforces this by force-overwriting protected fields (`id` / `source` / `schema` / `bridgeVersion`) on write — the user edits the editable manifest fields, the system owns the bookkeeping.
- **Text-only workspace**: the workspace is currently text-only. Binary content that doesn't fit text editing is out of scope until binary support is added.
- **Player secret config overrides** (`06-24-assistant-web-search`): a skill's declared config (`.env`-style `skill.config` file) **is** fileified — it is a card-content workspace file (visible, editable, exported with the package). But the player's *override values* (which carry real secrets like API keys) are stored in the `skillConfigs` Dexie table, **not** in the workspace, so they are never exported with a skill package. This mirrors the AI provider apiKey preset locality (secrets stay local; only an id reference or the declaration travels with distributable content). The two-layer split is intentional: `skill.config` = declaration + defaults (file, visible, exported); player overrides = secrets (Dexie, local, not exported). Runtime merges them (`tsian.config = { ...defaults, ...playerOverrides }`). See the "Skill Config Declaration And Player Overrides" scenario in `platform-web/frontend/state-management.md`.

When you hit a new exception, **register it explicitly** (in the relevant task PRD or this guide) rather than silently working around the principle. An unregistered exception erodes the principle; a registered one refines it.

---

## Thinking Triggers

Use this guide when:

- [ ] You're adding a new field to a game card, agent, or save record — ask: is this configurable content or internal bookkeeping?
- [ ] You're about to create a new Dexie table or key — ask: will this data be agent-visible through workspace tools?
- [ ] You're adding a new tool to let the agent manage something — ask: could this instead be a file the existing tools manage?
- [ ] You're tempted to store data in a private field because "it's simpler" — ask: does simplicity now cost the agent the ability to manage it later?
- [ ] A feature request implies the assistant should read/edit some platform data — ask: is that data currently a file, or hidden in a DB field?

---

## Anti-Patterns

- **Bad**: storing the assistant snapshot in a separate Dexie key invisible to workspace tools (breaks file-system visibility — the agent cannot `workspace_read` its own context).
- **Bad**: adding a new `agent_<thing>` tool because the data isn't a file — the tool count grows, the agent's capability is defined by tools instead of by visible files.
- **Bad**: embedding new configurable content as an array field inside an existing DB row (the "rewrite the whole card to change one file" pattern — what `06-21-content-files-per-file-table` is eliminating).
- **Bad**: silently exempting a new data kind from the principle without registering the exception.

---

## Relationship To Other Guides

- This is a **horizontal architecture principle**. It crosses packages (platform-web storage, agent-runtime, contracts `WorkspaceScope`).
- It interacts with the [Cross-Layer Thinking Guide](./cross-layer-thinking-guide.md): when data flows storage → workspace → agent, check that it stays file-shaped at every boundary, not just at the storage layer.
- It interacts with the [Code Reuse Thinking Guide](./code-reuse-thinking-guide.md): before adding a new storage primitive for new data, check whether an existing volume / file API already covers that shape.

---

**Core Principle**: If the agent can't see it as a file, the agent can't manage it. Prefer files over hidden DB fields for anything configurable.
