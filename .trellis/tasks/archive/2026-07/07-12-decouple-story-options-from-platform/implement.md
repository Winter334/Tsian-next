# Implement: 解耦平台硬编码剧情选项

## Steps

1. Runtime guard
   - Edit `apps/platform-web/src/agent-runtime/index.ts` and remove `[[选项]]` instruction.

2. Platform host
   - Edit `apps/platform-web/src/platform-host/index.ts` to stop calling `extractStoryOptions`.
   - Remove `emitTurnOptions` usage if only used for options.
   - Delete `apps/platform-web/src/platform-host/story-options.ts` if no references remain.

3. Default frontend parser
   - Add `apps/play-frontend-dev/src/lib/story-options.ts` with current parser.
   - Update imports in `useTsian.ts` and `useSetupState.ts`.

4. Default card prompt
   - Update三人写手 `AGENT.md` in `workspace-templates.ts` to include default frontend option marker convention.
   - Review setup skill wording; keep as default frontend convention.

5. Legacy comments/docs
   - Mark `packages/play-bridge/src/story-options.ts` comments as legacy optional helper.
   - Mark options event/type comments as legacy/backcompat where touched.

6. Validation
   - `npx tsc -p packages/contracts/tsconfig.json`
   - platform-web vue-tsc
   - play-frontend-dev build/type-check if script exists
   - `rg "extractStoryOptions|\[\[选项\]\]|turn-options"` manual placement check.

## Rollback

Revert the commit. Public contracts remain compatible because this task does not remove options types/events.