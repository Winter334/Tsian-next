# Runtime Workspace

This effective workspace combines Game Card content with active save runtime data. Runtime play data lives under `save/`.
The `.tsian/` directory is platform-owned metadata and is hidden from ordinary Agent, Skill, and frontend workspace APIs.

This default card uses the novel AIRP backstage crew: `storyteller`, `stage-manager`, and `world-architect`. Read `docs/novel-airp-schema-guide.md` before changing novel source, schema, entity, or playthrough files.

Opening setup is one temporary `world-architect` interview. Its latest valid `[[开局会话]]` block in the source-derived dynamic context slot is the authoritative interview progress. `save/playthrough/opening-interview.json` stores only session control, a submitted/failed attempt, and the final receipt; it is not a second model draft. `save/playthrough/setup-summary.json` with `status: "complete"` is the durable completion signal.

`save/playthrough/understanding-summary.json` remains as a pending compatibility file, but the current frontend and opening Skill do not consume it. Incomplete saves from the retired opening flow are not migrated or cleaned; they must fail closed and ask the player to create a new save.
