# Design — 正文内嵌插图交互

## 1. Data Flow

```text
platform settled assistant
  {turn, content, displayContent, projections}
        |
        v
ordered settled parser + shared brief validator
        |
        +--> prose segments -> Markdown
        +--> illustration segments
               target {turn,"illustrations",index}
                         |
                         +--> stable path probe -> ready image
                         +--> player activation
                                -> invokeAgent({brief,prose},{generatedMediaTarget})
                                -> durable completion
                                -> stable path probe
```

The target coordinates are the only identity shared with Host. The frontend never derives source revisions or commit authority.

## 2. Settled Assistant Model

Introduce or extend the assistant stream item so settled entries retain:

```ts
interface SettledAssistantView {
  kind: "assistant"
  turn: number
  content: string
  displayContent?: string
  projections?: Record<string, unknown>
  totalTokens?: number
}
```

Live completion and history hydration use one constructor/normalizer. Opening publication supplies turn 0 through the same model. Streaming remains a separate draft shape with no target-capable metadata.

Any history/window key should include the persisted turn identity rather than a transient array index. Existing choice extraction continues reading the same `projections` object.

## 3. Ordered Segmentation

The settled parser walks complete marker spans in display text. For each span it:

1. emits preceding prose;
2. assigns the marker ordinal as projection index;
3. reads `projections.illustrations[index]` without coercion;
4. requires exact trimmed equality with the marker capture for interactivity;
5. validates through the shared brief validator;
6. emits a valid interactive/noninteractive illustration or bounded fallback;
7. emits trailing prose.

The valid-card counter, not marker count, determines the first three interactive briefs. The projection index still counts every complete marker, so invalid marker N cannot shift later Host targets.

Only prose segments enter Markdown. A streaming sanitizer buffers from an unmatched opener and drops isolated closing markers; it never creates illustration state before settlement.

## 4. Capability Lifecycle

One initialization composable loads and normalizes entrypoints, then exposes cached capability state: `loading | available | unavailable`. Illustration components remain noninteractive while loading and unavailable; there is no late hardcoded fallback.

The optional entrypoint controls Agent discovery only. Provider configuration and Tool permission errors remain per-attempt runtime failures.

## 5. State Registry

Use a small module/composable registry keyed by canonical target coordinates:

| State | Image | Activation |
|---|---|---|
| `idle` | none | generate |
| `generating` | none | disabled |
| `ready` | current URL | lightbox / regenerate |
| `regenerating` | old URL | lightbox available, regenerate disabled |
| `error` | old URL if any | retry or regenerate |

Each entry holds an attempt token, load token, optional URL, media type and short safe error category. It does not persist prompt, Agent result, raw Blob or Provider data.

There is no global generation queue. Same-key exclusion lives in the registry; different keys run independently.

## 6. Invocation and Readback

For an eligible segment:

```ts
const request = { brief, prose: assistant.content }
const options = { generatedMediaTarget: target }
await tsian.invokeAgent(cachedAgentId, request, options)
const path = generatedMediaPath(target)
const file = await tsian.workspace.read(path)
```

The Agent result must match the closed v1 result shape so protocol failures are visible, but its `asset.path` is not used to select a file. A resolved invocation means Host commit completed; readback from the helper-derived path is the durable confirmation.

Workspace read accepts only a raster Blob with supported media type and successful image decode. Failures keep the existing ready image during regeneration and otherwise return to retryable error.

## 7. Reload, Restore and Windowing

Every mounted settled illustration first probes its stable path. This makes the persisted workspace asset the only cross-session UI state.

Story restore orchestration increments a frontend lifecycle epoch before invoking platform restore. All mounted URLs are released and dialogs close. After the current workspace/timeline is rebuilt, new cards probe again. Invocation, read and decode callbacks capture epoch + attempt token and no-op when stale.

Unmount caused only by history windowing revokes the component URL but does not delete registry identity or durable asset. Remount re-probes; registry pruning removes targets no longer present in the rebuilt history.

## 8. Components

- `NarrativeMessage` receives settled assistant segments rather than one opaque Markdown string.
- Plain prose keeps the current typography.
- An illustration component owns card visuals, state actions and URL display.
- A dedicated lightbox owns dialog/focus/scroll lifecycle.
- Existing `SceneImage` and portrait Object URL patterns may be reused where behavior matches; do not retain decorative placeholders that conflict with inline brief semantics.

Components receive target/brief/state callbacks and do not call Host APIs directly. Invocation/probe logic stays in a composable/service layer.

## 9. Dual Source and Packaging

Implement task-owned changes in the development source, mirror them deliberately into actual card source, and compare those files individually. Then build `play-frontend-dev` and run the existing card package/repack command to update hashed dist and manifest. No packaging source code is changed by this task.

## 10. Failure Boundaries

- Invalid protocol data: omit/fallback that marker only.
- Missing capability: show noninteractive descriptions.
- Invocation/Provider/Host stale failure: mark current key only.
- Stable path absent: idle if never generated; keep old image on failed regeneration.
- Blob decode failure: revoke candidate URL, retain old ready URL when present.
- Restore/unmount race: stale callback no-ops after cleanup.
