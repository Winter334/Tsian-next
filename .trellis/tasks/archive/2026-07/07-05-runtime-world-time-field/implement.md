# Implement: runtime.worldTime 世界层时间固定字段

## Preconditions

- Task is planning until reviewed and started with `task.py start`.
- `worldTime` shape is confirmed as `string`; empty string means unknown / not established.

## Implementation Checklist

1. Update `apps/platform-web/src/storage/workspace-templates.ts` runtime contract text.
   - Add `worldTime` to the `COMMIT_RUNTIME_AND_FRONTIER_SCRIPT_JS` input comment.
   - Add runtime guide wording that `worldTime` is current story/world time, not platform time.
   - Update runtime JSON example to use top-level `"worldTime": "赤明纪十二年三月初七，黄昏"` instead of `extensions["当前时间"]`.
   - Keep `extensions` example for non-fixed dynamic mechanisms only.

2. Update opening runtime write script.
   - Normalize `input.runtime.worldTime` to a string:
     - string → trimmed string;
     - non-string / missing → `""`.
   - Add `worldTime` to `runtimeFile` near `turn`.
   - Do not fail opening initialization for missing/invalid `worldTime`.

3. Update default save runtime template.
   - Add `worldTime: ""` to `save/playthrough/runtime.json` default content.
   - Update `save/playthrough/README.md` default text to mention `worldTime`.
   - Update `save/schema/current.md` default text to mention `worldTime` as fixed runtime field.

4. Update Agent/Skill guidance in the same template file.
   - In `STAGE_MANAGER_STATUS_SKILL_MD`, instruct stage manager to maintain `runtime.worldTime` when the story establishes or advances current time.
   - Keep guidance lightweight: no full calendar requirement.

5. Update play frontend runtime types and parser.
   - Add `worldTime: string` to `Runtime` in `apps/play-frontend-dev/src/lib/runtime-types.ts`.
   - In `parseRuntime`, read `worldTime` directly from the validated input.
   - Add `worldTime` to `isRuntimeLike` required checks: missing or non-string `worldTime` → `load-failed`. No backward-compatibility fallback.

6. Reverse-search for stale extension-only current-time examples.
   - Search `当前时间`, `worldTime`, `runtime.json`, and `activeSceneIds` in touched docs/template areas.
   - Ensure examples no longer imply the primary current time belongs only in `extensions`.

7. Validation.
   - Run `npm run build --workspace play-frontend-dev`.
   - Run `npm run build:web`.
   - Run `git diff --check`.

## Review Gates

- Before starting implementation, confirm task activation through Trellis (`task.py start`) after planning review.
- After implementation, check that old runtime data without `worldTime` still parses.
- If build fails, fix or report exact failure output; do not claim completion.

## Risk / Rollback Points

- `workspace-templates.ts` is a large file with many embedded strings. Use focused exact edits and reverse-search after edits.
- Opening script is embedded JS-in-string; syntax errors surface only during build/runtime. Keep changes minimal.
- `parseRuntime` required-field enforcement matters: `worldTime` is now a required field; do not silently normalize missing/wrong-typed values.
- Rollback by reverting the template, parser, and type additions; no storage migration is involved.
