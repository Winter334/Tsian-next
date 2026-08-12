# Runtime Workspace

This effective workspace combines Game Card content with active save runtime data. Runtime play data lives under `save/`.
The `.tsian/` directory is platform-owned metadata and is hidden from ordinary Agent, Skill, and frontend workspace APIs.

This default card uses the novel AIRP backstage crew: `storyteller`, `stage-manager`, and `world-architect`. Read `docs/novel-airp-schema-guide.md` before changing novel source, schema, entity, or playthrough files.

Opening setup is one temporary `world-architect` interview. The player transcript under `save/agents/world-architect/transcripts/` restores successful visible dialogue. `save/playthrough/opening-notes.md` is an optional Agent-maintained semantic work note, while `opening-interview.json` identifies the source, session slot, and character branch. `save/playthrough/setup-summary.json` with `status: "complete"` is the sole durable completion signal.

`save/playthrough/understanding-summary.json` remains as a pending compatibility file, but the current frontend and opening Skill do not consume it. Incomplete saves from the retired opening flow are not migrated or cleaned; they must fail closed and ask the player to create a new save.
