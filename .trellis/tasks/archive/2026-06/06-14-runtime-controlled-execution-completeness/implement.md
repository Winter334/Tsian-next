# Runtime Controlled Execution Completeness Implementation Plan

## Checklist

1. Load project coding specs with `trellis-before-dev` before editing implementation files.
2. Add the runtime policy types and optional context field in `apps/platform-web/src/agent-runtime/workspace-tools.ts`.
3. Add a default code-level policy that allows `builtin`, `platform_action`, and `browser_script`.
4. Check policy inside `executeSkillAction` before dispatching supported executors.
5. Return `ACTION_EXECUTOR_DISABLED` as a structured failed observation when an injected policy denies execution.
6. Add optional `outputSchema` to parsed action declarations in `apps/platform-web/src/agent-runtime/workspace-tools.ts`.
7. Validate `outputSchema` declarations during `skill_load`; malformed schemas should produce `ACTION_OUTPUT_SCHEMA_INVALID` declaration errors and skip that action.
8. Add lightweight output validation after successful executor execution and before returning the `action_call` success observation.
9. Return `ACTION_OUTPUT_INVALID` as a structured failed observation when declared output validation fails.
10. Expose `hasOutputSchema` in loaded action summaries and `action_call` result metadata.
11. Add the compact trace event type in `apps/platform-web/src/agent-runtime/trace.ts`.
12. Emit `action_executor_policy_checked` with metadata-only data.
13. Thread the optional policy through runtime capabilities if needed by existing context construction.
14. Update active docs/specs that describe browser script trust/enable policy and Skill action `outputSchema`.
15. Validate with `npm run build --workspace platform-web`, `git diff --check`, and `python3 ./.trellis/scripts/task.py validate 06-14-runtime-controlled-execution-completeness`.

## Risk Points

- Do not expose raw action input or script content in policy traces.
- Do not move platform-host storage or Worker details into `agent-runtime`.
- Do not add Settings UI or localStorage config in this slice.
- Do not change staged workspace transaction behavior.
- Preserve existing unsupported executor handling for executor types without an adapter.
- Do not implement full JSON Schema. Keep `outputSchema` to the lightweight type/required/properties subset and document unsupported keywords as ignored.
- Do not store full executor output in validation errors or trace.

## Rollback

The change should be limited to Agent Runtime execution policy, optional output validation, trace typing, and documentation. If the policy creates compatibility issues, remove the optional policy field and policy check while leaving existing executor dispatch paths intact. If output validation creates compatibility issues, remove `outputSchema` parsing/validation while leaving existing `inputSchema` and executor dispatch behavior intact.
