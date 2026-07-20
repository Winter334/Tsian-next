# Implement: 移除资料员 Agent

## Scope

Edit current card and default workspace templates:

- `cards/沉浸阅读器.tsian-card/**`
- `apps/platform-web/src/storage/workspace-templates/**`

Do not edit platform contracts or runtime collaboration code.

## Steps

1. Remove current card researcher resources
   - Delete `cards/沉浸阅读器.tsian-card/workspace/agents/researcher/`.
   - Remove corresponding entries from `cards/沉浸阅读器.tsian-card/game-card.json`.

2. Clean current card Agent config and prompts
   - Remove `researcher` from stage-manager contacts.
   - Remove `researcher` from world-architect contacts.
   - Rewrite stage-manager / world-architect AI-facing lines that currently say “call 资料员”.
   - Clean stage-manager schema Skill line that mentions 资料员.

3. Clean current card docs
   - Update workspace README default crew list.
   - Update `docs/tsian-framework-knowledge.md` background specialists list.
   - Update `docs/novel-airp-schema-guide.md` Agent duties.
   - Update `docs/novel-airp-schema-reference.md` frontier consumer wording.

4. Remove default template researcher resources
   - Delete `apps/platform-web/src/storage/workspace-templates/agents/researcher.ts`.
   - Remove imports/spreads from `files.ts`.
   - Remove default `save/agents/researcher/notes.md` from `files.ts` and `constants.ts`.

5. Clean default template Agent config and prompts
   - storyteller: remove contact/researcher references in summary, writing style Skill, AGENT text.
   - stage-manager: remove researcher contact and prompt references.
   - world-architect: remove researcher contact and prompt references.

6. Clean default template docs
   - `docs/airp.ts`: remove researcher duty and frontier “供资料员” wording.
   - `docs/framework.ts`: remove researcher from background specialists.
   - `files.ts` README / agents README default crew lines.

7. Manifest/version checks
   - Ensure `game-card.json` resource list no longer contains `workspace/agents/researcher`.
   - Decide whether `DEFAULT_WORKSPACE_VERSION` needs bump after implementation review. Do not add destructive migration.

8. Validation
   - `rg -n "researcher|资料员|资料检索" cards/沉浸阅读器.tsian-card apps/platform-web/src/storage/workspace-templates --glob '!frontend/dist/**'`
   - Accept zero hits in current card/templates; historical docs outside scope may still contain old references.
   - `npm run build:web`

## Rollback

Revert the commit. No persistent data migration is performed, so rollback only restores template/card files.
