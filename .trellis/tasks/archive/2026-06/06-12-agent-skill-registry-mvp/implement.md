# AGENT.md/SKILL.md Registry MVP Implementation Plan

## Checklist

1. Read implementation guidelines with `trellis-before-dev`.
2. Add shared registry contract types in `packages/contracts/src/runtime.ts`.
3. Extend default workspace initialization:
   - add default master/narrative `AGENT.md`;
   - add `notes.md` and `session.jsonl` placeholders for both default agents.
4. Add a workspace file listing helper if needed:
   - return public `WorkspaceFile[]` without Dexie-only fields.
5. Implement pure registry parsing in `apps/platform-web/src/agent-runtime/registry.ts`:
   - parse simple frontmatter;
   - extract Markdown H1/body fallback;
   - discover agent entries;
   - discover shared and agent-local skill entries;
   - filter skill registry by optional params.
6. Integrate bridge query resources in `apps/platform-web/src/platform-host/index.ts`:
   - `agent-registry`;
   - `skill-registry`.
7. Keep existing runtime execution unchanged.
8. Run validation:
   - `npm run build:contracts`;
   - `npm run build:web`.
9. Update docs/specs only if implementation reveals a reusable convention not already documented.

## Risk Points

- Frontmatter parser should not throw for malformed documents.
- Skill registry must not expose full skill body or actions.
- Agent-local skill id collisions are acceptable because `scope`, `agentId`, and `path` disambiguate entries.
- Existing saves may not have default AGENT files; bridge queries should return empty registries rather than fail.
- Avoid importing Dexie/storage directly into runtime parser code.

## Review Gates

- Do not start implementation until the planning artifacts are approved.
- Keep changes scoped to contracts, workspace defaults, registry parser, and platform-host bridge queries.
- Do not add UI.
- Do not modify `runAgentRuntimeTurn` behavior in this task.

## Validation Commands

```bash
npm run build:contracts
npm run build:web
```

