# Implementation Plan

1. **Capture and validate the contract**
   - Preserve the current dirty baseline outside the worktree in `.git/`.
   - Search every equipment, applied, modifier and extensions.render occurrence before editing.
   - Keep dynamic slots, container reachability and Agent-maintained contribution snapshots.

2. **Synchronize internal schema sources**
   - Update AIRP guide/reference template text in `docs/airp.ts`.
   - Update `save/schema/current.md` and `save/entities/README.md` seeds in `files.ts`.
   - Restore explicit unknown-render warn-and-hide behavior.
   - Keep workspace version unchanged.

3. **Synchronize internal Stage Manager**
   - Refine the equipment maintenance section in `stage-manager.ts`.
   - Keep existing Agent/tool/context architecture.
   - Make full-role maintenance and uncertainty behavior explicit without claiming a platform evaluator.

4. **Synchronize the formal card**
   - Apply the same Schema contract to guide/reference Markdown.
   - Add equipment authority and maintenance domain to Stage Manager AGENT/回合后维护 Skill.
   - Preserve `read_maintenance_context`, generic edit tools, recall commit, scene cleanup and summaries.

5. **Rebuild workspace inventory only**
   - Parse current `game-card.json` and snapshot non-workspace inventory/metadata.
   - Enumerate current workspace recursively and replace only `workspaceFiles`.
   - Assert deleted update_entity entries are gone and json_edit/text_edit entries exist.

6. **Quality checks**
   - Run `npm run build:web`.
   - Parse package/Agent/tool JSON and compile relevant run.js bodies with the existing browser-tool convention.
   - Verify workspace manifest path, ordering, mediaType and byte-size equality.
   - Grep for synchronized equipment and unknown-render contracts.
   - Run `git diff --check` and protected-scope diff checks.
   - Dispatch full-scope Trellis check and fix findings.

7. **Commit and finish**
   - Commit implementation and task artifacts as separate coherent commits.
   - Confirm only 07-21 planning edits remain dirty.
   - Archive the task and record the work commits in the developer journal.

## Stop Conditions

- Do not add a runtime modifier parser or player mutation UI.
- Do not copy the internal Stage Manager wholesale over the formal card.
- Do not run frontend packaging or change either frontend tree.
- Do not bump workspace version or claim existing-save migration.
- Do not reset, stash or overwrite unrelated dirty work.
