# Game Card And Remote Frontend Foundation Implementation Plan

## Parent Checklist

1. Seed child PRDs.
2. Select first child: `06-14-game-card-library-save-model`.
3. Complete child implementation/check/archive loops one at a time.
4. After each child, update this parent PRD checklist and active docs/specs if direction changes.
5. Do not archive parent until completed children and explicitly deferred children are reflected here.

## Child Order

1. `06-14-game-card-library-save-model`
   - Required before remote frontend bridge because PlayView needs an active game card frontend binding.

2. `06-14-workspace-assistant-agent-template`
   - Can be implemented with or immediately after the local game card model.
   - It should update the built-in blank card/workspace template.

3. `06-14-remote-iframe-frontend-bridge`
   - Depends on game card model.
   - May use the built-in blank card fallback while remote card examples are minimal.

4. `06-14-game-card-import-export-package-format`
   - Deferred until local card model and remote frontend bridge stabilize.

## Parent Validation

```bash
python3 ./.trellis/scripts/task.py validate 06-14-remote-game-frontend-foundation
git status --porcelain
```

Each child owns its own build/test commands. Expected shared commands for implementation children:

```bash
npm run build:contracts
npm run build:runtime-core
npm run build:web
git diff --check
```

## Follow-Up Review

Before starting a child task, review:

- parent PRD/design/implement;
- child PRD;
- active docs in `docs/active/`;
- relevant `.trellis/spec` package guidelines through `trellis-before-dev`.
