# Runtime Workspace Completeness

## Goal

Complete the Runtime Workspace virtual filesystem contract enough that future workspace UI, Agent self-modification, Skill packages, diagnostics, and save import/export work can rely on stable path visibility, metadata ownership, file typing, and checkpoint semantics.

This is the fifth child of `.trellis/tasks/06-13-runtime-foundation-completion`.

## User Value

- Agents and Skills get a predictable ordinary workspace surface instead of accidentally seeing or mutating host-owned metadata.
- Future UI can browse and edit workspace files without encoding MVP-era assumptions about `.tsian`, traces, manifests, or cache/index paths.
- Save/checkpoint behavior remains inspectable and recoverable while keeping platform internals out of normal AIRP narrative flow.
- Later Agent/Skill design can use README/schema files and media types as stable conventions rather than hardcoded platform gameplay schemas.

## Confirmed Facts

- Runtime Workspace files are stored in Dexie `workspaceFiles` and represented by `WorkspaceFile` with `path`, string `content`, `mediaType`, `createdAt`, and `updatedAt`.
- New saves seed ordinary workspace directories (`agents`, `skills`, `history`, `world`, `memory`, `frontend`, `archive`) plus platform metadata under `.tsian/`.
- Current `.tsian/manifest.json` only stores `version` and `workspaceVersion`; default workspace version is currently `2`.
- Current seeded `.tsian` directories are `traces`, `checkpoints`, `indexes`, and `cache`, each with a README.
- `normalizeWorkspaceFilePath` rejects empty paths, trailing-slash file paths, `.` segments, `..` segments, and empty path segments.
- `normalizeMediaType` infers common text types from `.md`, `.json`, `.jsonl`, `.ts`, and `.js`, otherwise defaulting to `text/plain`.
- Runtime turn transactions already reject ordinary Agent/Skill writes and deletes under `.tsian/*`, while platform-owned trace writes use `writePlatformFile`.
- Direct bridge `platform.runAction({ action: "workspace-write" | "workspace-delete" })` currently writes immediately and does not enforce `.tsian/*` protection at the storage helper boundary.
- Ordinary bridge/runtime list and search currently hide only `.tsian/traces/` by default, not all `.tsian/*`.
- Exact workspace reads currently can read `.tsian/*` if the caller knows the path.
- Runtime diagnostics are already generated on demand from raw `.tsian/traces/turns/*.jsonl` by internal platform code, not by ordinary workspace list/search.
- Checkpoints store full workspace file snapshots, including `.tsian/*`, and restore workspace files from checkpoint records.
- There are no existing `*.test.ts` / `*.spec.ts` files in `apps/platform-web` for this area; validation currently relies on builds plus focused probes.

## Requirements

- Define a single workspace visibility contract:
  - ordinary Agent/Skill/frontend workspace surfaces hide all `.tsian/*` metadata by default;
  - platform-owned internals may still access `.tsian/*` through internal helpers or dedicated bridge resources;
  - diagnostics remain available through `runtime-diagnostics`, not raw trace browsing.
- Protect platform metadata consistently:
  - ordinary writes and deletes must reject `.tsian/*` across staged runtime transactions, browser-script SDK writes, and direct bridge `workspace-write` / `workspace-delete`;
  - platform-owned writes such as trace persistence remain possible through explicit platform-only paths.
- Keep path normalization strict and consistent across storage, Agent Runtime tools, browser-script SDK, and bridge queries.
- Make media type behavior explicit enough for future UI and Skills:
  - text file content stays string-based for this phase;
  - existing inferred media types remain compatible;
  - no binary file support is introduced in this child.
- Clarify checkpoint/import/export implications without building the final UI:
  - full save/checkpoint snapshots preserve `.tsian/*`;
  - ordinary workspace browsing/export surfaces should not expose `.tsian/*` unless a future task designs a dedicated management/debug mode;
  - index/cache paths under `.tsian/indexes/` and `.tsian/cache/` are platform-owned and replaceable.
- Update active docs/specs so future work treats Runtime Workspace visibility and metadata ownership as authoritative.
- Preserve existing successful MVP behavior unless it conflicts with `.tsian/*` ownership or ordinary workspace visibility.

## Acceptance Criteria

- [x] The task records an authoritative ordinary-vs-platform workspace visibility contract.
- [x] Storage helpers expose or enforce a reusable platform metadata visibility decision instead of trace-only filtering.
- [x] Default `workspace-list` and `workspace-search` do not expose `.tsian`, `.tsian/manifest.json`, `.tsian/traces`, `.tsian/indexes`, or `.tsian/cache`.
- [x] Ordinary exact `workspace-read` for `.tsian/*` does not expose platform metadata through live Agent, browser-script SDK, or normal bridge workspace query paths.
- [x] Direct bridge `workspace-write` / `workspace-delete` reject `.tsian/*` with a structured workspace error.
- [x] Runtime trace persistence and `runtime-diagnostics` still work through platform-owned access.
- [x] Checkpoint create/restore still preserves all workspace files, including platform metadata.
- [x] The seeded workspace README/manifest wording reflects path ownership, index/cache replaceability, and text-only file content assumptions.
- [x] Compatibility for current registry, Skill detail, Agent context, raw history, session transcript, maintenance Skill, and diagnostics behavior is preserved.
- [x] Active docs/specs are updated for the finalized workspace contract.
- [x] `npm run build:contracts` passes if contracts are changed.
- [x] `npm run build:web` passes.
- [x] Focused probe or equivalent validation demonstrates hidden `.tsian/*`, protected metadata writes, and internal diagnostics/checkpoint compatibility.

## Out Of Scope

- Final workspace browser/editor UI.
- Settings UI or runtime popups for platform metadata visibility.
- `stateRecords` migration into workspace files.
- Binary/blob workspace content.
- Remote import/export file picker UX.
- Hardcoded world, character, memory, relationship, or frontend gameplay schemas.
- Destructive trace pruning or cache/index retention policy.
- Raw trace exposure as a normal live Agent tool.

## Resolved Questions

- Ordinary bridge workspace queries must not expose `.tsian/*`, even through an opt-in parameter in this child. Use dedicated platform/debug resources such as `runtime-diagnostics` for Agent-facing facts, and reserve any raw metadata browser for a later explicit management/debug UI task.
  - Rationale: normal AIRP and authoring surfaces remain cleaner and harder to accidentally couple to platform internals.
  - Trade-off: future raw metadata inspection will need a dedicated query/resource instead of reusing generic workspace list/read/search.
