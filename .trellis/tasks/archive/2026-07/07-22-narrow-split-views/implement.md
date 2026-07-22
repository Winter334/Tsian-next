# Implementation Plan

1. **Studio compact Agent selection**
   - Add a named inline-size container to the route root.
   - Add compact Agent selector and current-directory action.
   - Convert the main layout to local container-query columns/rows.
   - Keep the existing Agent sidebar for wide mode and reuse selection handlers.

2. **Assistant session drawer**
   - Add route-local drawer state and open/close wrappers.
   - Add a compact session trigger to the chat header and a compact close action to the sidebar.
   - Keep the sidebar mounted; use container-query CSS for static-column versus overlay-drawer positioning.
   - Close after session selection/creation without changing session/runtime internals.
   - Ensure the composer flex input can shrink within compact width.

3. **Market compact filters**
   - Reorganize toolbar groups so upload/back and sorting share the primary row.
   - Add compact type select and scope toggle for list mode.
   - Convert the main layout and toolbar to named container-query behavior.
   - Preserve the existing desktop sidebar and all existing filter handlers.

4. **Review and validation**
   - Inspect the full diff for accidental business-logic changes and wide-layout regressions.
   - Run `npm run build:web` and `git diff --check`.
   - Hand all three completed views to the user for one combined manual acceptance pass.

## Review Gates

- Do not add a shared responsive split component.
- Do not conditionally unmount the assistant chat pane.
- Do not change storage, runtime, platform-host, contracts, or market APIs.
- If compact controls require duplicate state rather than shared handlers, stop and simplify before continuing.
