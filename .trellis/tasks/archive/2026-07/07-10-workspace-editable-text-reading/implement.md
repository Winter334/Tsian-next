# Implementation Plan

## 1. Central classification and projection

- [x] Expand `lib/media-type.ts` mappings and structured textual MIME recognition.
- [x] Add meaningful MIME resolution and a shared text-path predicate.
- [x] Let binary placeholder generation use the resolved MIME.
- [x] Add `lib/workspace-blob.ts` with fatal UTF-8 text decoding and binary/image projection.
- [x] Replace duplicated card-frontend projection in host and storage with the helper.
- [x] Replace frontend-build's text extension regex with the shared predicate.

Review gate: existing octet-stream `.vue` resolves as text by path; known binary assets remain binary.

## 2. MIME-preserving persistence and packages

- [x] Add optional `mediaType` to the internal frontend-file write input.
- [x] Resolve Blob type according to input kind and explicit MIME precedence.
- [x] Pass whole-card package frontend MIME through import.
- [x] Pass standalone frontend package MIME through import.
- [x] Export whole-card and standalone manifests from effective Blob type.

Review gate: no `db.ts`, DB name, contract, or service worker schema change.

## 3. Consumer safety and attachment reads

- [x] Reject binary load/write results in `WorkspaceEditorView.vue` before applying content.
- [x] Route SVG to the editor while keeping raster/audio/video media routing.
- [x] Add compatible CodeMirror path mappings for module variants, SFC-like files, and style preprocessors.
- [x] Infer empty attachment MIME from filename.
- [x] Decode temporary text attachment contents into Agent snapshots.
- [x] Ensure ordinary projected images carry `imageMimeType`.

Review gate: no placeholder can become an editor baseline; temp text reads no longer return empty content.

## 4. Static validation

- [x] Reverse-search all `inferMediaTypeFromPath`, `isTextMediaType`, `binaryPlaceholderText`, and frontend Blob projection call sites.
- [x] Inspect diff for duplicated extension tables or accidental scope expansion.
- [x] Run `npm run build:web`.
- [x] Dispatch `trellis-check` and address all blocking findings.
- [x] Run final build after review fixes.

Browser validation is intentionally delegated to the user. Do not start Vite/Playwright unless the user later requests diagnosis.

## 5. User browser checklist

- [x] Open/edit/save/reopen `frontend/src/App.vue`; verify source round-trip and no placeholder.
- [x] Ask desktop Agent to read/search/edit/diff the same Vue file.
- [x] Confirm source edit triggers rebuild and `/play` reload.
- [x] Open SVG in editor; open PNG/audio/video in media viewer.
- [x] Upload a text attachment and ask Agent to read it.
- [ ] If available, verify a legacy octet-stream Vue row recovers without migration.

## Validation Commands

```bash
npm run build:web
rg -n "inferMediaTypeFromPath|isTextMediaType|binaryPlaceholderText|isTextBuildSourcePath" apps/platform-web/src
rg -n "gameCardFrontendFiles|PutLocalGameCardFrontendFileInput|frontendFiles:" apps/platform-web/src/storage
```

## Risk / Rollback Points

- `media-type.ts`: a broad false positive could decode binary bytes as text. Keep binary negative controls explicit and unknown extensions binary.
- package import/export: MIME precedence must not overwrite a meaningful Blob MIME with octet-stream.
- editor: guard both initial load and post-write response.
- attachment snapshot: asynchronous decoding must happen before Agent runtime receives the snapshot.
- no migration means old rows rely on generic-MIME fallback to corrected path inference.
