# Workspace Assistant Agent Template Implementation Plan

## Checklist

1. Update the default workspace template:
   - add `docs/README.md`;
   - add `docs/tsian-framework-knowledge.md`;
   - add `agents/studio-assistant/AGENT.md`;
   - add `agents/studio-assistant/notes.md`;
   - add `agents/studio-assistant/session.jsonl`;
   - add `agents/studio-assistant/skills/framework-knowledge/SKILL.md`.
2. Bump the default workspace version and add the new files to the upgrade allow-list so existing saves receive missing assistant substrate without overwrites.
3. Point the built-in blank game card manifest assistant metadata at `studio-assistant`.
4. Update active docs/specs:
   - assistant is workspace/game-card content, not hidden platform persona;
   - knowledge base + query Skill are ordinary workspace files;
   - polished first-launch world creation/default content remains deferred.
5. Validate:
   - `npm run build:contracts`;
   - `npm run build:runtime-core`;
   - `npm run build:web`;
   - `python3 ./.trellis/scripts/task.py validate 06-14-workspace-assistant-agent-template`;
   - `python3 ./.trellis/scripts/task.py validate 06-14-remote-game-frontend-foundation`;
   - `git diff --check`.

## Risky Files / Rollback Points

- `apps/platform-web/src/storage/workspace.ts`: large default-template literal and migration version.
- `apps/platform-web/src/storage/game-cards.ts`: built-in card manifest assistant metadata.
- Docs/specs: keep wording aligned with the current Agent Runtime direction and avoid implying a platform-owned assistant UI.

Rollback should remove the new template files and restore the manifest assistant entry. Existing user saves that already received the files can keep them as ordinary workspace content.
