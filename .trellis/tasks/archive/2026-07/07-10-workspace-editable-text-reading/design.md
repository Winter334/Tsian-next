# Technical Design

## Overview

The bug is a classification and projection drift across five stages:

```text
package manifest / editor input
  → Blob creation (`game-cards.ts`)
  → IndexedDB `gameCardFrontendFiles.data`
  → Blob-to-WorkspaceFile projection (Studio or Agent snapshot)
  → shared workspace operations
  → editor / Agent tool consumer
```

The design keeps path inference in `lib/media-type.ts`, adds one Blob projection helper in `lib/`, and preserves explicit package MIME in `Blob.type`. It deliberately does not add an internal `mediaType` field to workspace records or Dexie rows.

## 1. Media-type and editable-text policy

### Central API

`lib/media-type.ts` remains the source of truth and gains these concepts:

- path → media type inference for known extensions and exact configuration filenames;
- `isTextMediaType(mediaType)`, including structured text application types and SVG;
- effective Blob media type resolution: a meaningful explicit Blob type wins, while blank and `application/octet-stream` fall back to path inference;
- text-path predicate derived from path inference rather than a second extension table.

Exact names and suffix patterns are required for extensionless text files such as `skill.config`, `.env`, `.gitignore`, `Dockerfile`, and `Makefile`. Lower-casing preserves case-insensitive behavior.

Known unknown extensions remain `application/octet-stream`; the design does not globally classify all frontend files as text because the same table stores images, fonts, WASM, archives, and arbitrary assets.

### MIME precedence

```text
meaningful explicit Blob/package MIME
  > known path inference
  > requested fallback / application/octet-stream
```

`application/octet-stream` is generic rather than meaningful. This allows existing rows created before the `.vue` mapping to recover automatically.

## 2. Shared Blob projection

Add a focused `lib/workspace-blob.ts` helper that accepts:

- path;
- Blob;
- timestamps.

It returns a `Promise<WorkspaceFile>`:

- textual effective type → fatal UTF-8 decode into `content`;
- binary effective type → placeholder + `binary`;
- binary image → also set `imageMimeType`.

The helper owns the only Blob-to-workspace text/binary split. Both `cardFrontendVolume` and `listEffectiveWorkspaceFilesForSave` call it. Placeholder generation receives the resolved media type so it does not contradict an explicit Blob MIME.

Strict UTF-8 uses `new TextDecoder("utf-8", { fatal: true })`. Decode failure propagates as a clear path-specific error. Package boundary decoding already uses this policy, so online editing now avoids silently replacing invalid bytes as well.

## 3. Frontend builder parity

The build engine no longer owns a regex listing textual source extensions. It calls the central text-path predicate for each `frontend/src/**` file. Binary images/fonts/WASM remain `Uint8Array`; all centrally classified text files become strings.

This means future text extension additions propagate to Studio, Agent, and the build source loader together. It does not add a compiler or esbuild loader for unsupported frameworks; compilation support remains plugin-owned.

## 4. Package MIME preservation

`PutLocalGameCardFrontendFileInput` gains optional `mediaType`.

Blob construction resolves type as follows:

- explicit `mediaType`, when nonblank;
- meaningful type already present on a caller Blob;
- inferred path type;
- octet-stream fallback.

For string writes without explicit MIME, use path inference with `text/plain` fallback because the caller has supplied text. For byte/Blob writes, unknown paths keep octet-stream.

Both whole-card and standalone frontend package imports pass their manifest MIME into this input. Both export paths use the effective stored Blob type before path fallback. This meets the existing external contract through `Blob.type`, with no Dexie shape change.

## 5. Editor and routing safety

`WorkspaceEditorView.vue` checks `file.binary` on load and on every write result. Binary results throw a user-facing error before `applySavedFile`, ensuring placeholder text never becomes the draft or expected-content baseline.

The save function remains unavailable after a failed load because no binary content is loaded. This is a defense-in-depth guard independent of routing.

`WorkspaceExplorerView.vue` routes SVG to the text editor before the generic image branch. CodeMirror maps compatible source families to existing TypeScript, JavaScript, HTML, and CSS modes without new dependencies.

## 6. Temporary attachment reads

The assistant turn snapshot already has attachment records and Blob data in memory. For text attachments it decodes `record.data` into `content` while constructing the snapshot; images keep binary + `imageMimeType`. The storage save path uses filename inference when browser `File.type` is empty.

This fixes the current impossible lazy-read comment: `workspace_read` only reads the prepared snapshot and has no storage callback.

## Compatibility

- Existing generic `.vue` Blobs recover by path inference; no migration.
- Existing meaningful Blob MIME remains authoritative.
- Workspace and package contract types remain unchanged.
- Dexie row shape and DB name remain unchanged.
- Path security, access-level checks, `.tsian` rules, and package path normalization are untouched.

## Trade-offs

- Broad text recognition improves editability but does not promise compilation. This distinction is documented in PRD and code naming.
- Fatal UTF-8 can surface errors for mislabeled legacy files; this is preferred over silent data corruption.
- No unit-test framework is introduced. Static/type/build checks plus the user-run browser matrix are used for this change.

## Rollback

The change is code-only. Rollback consists of reverting the shared helper and call-site changes. No stored data or schema migration must be reversed.
