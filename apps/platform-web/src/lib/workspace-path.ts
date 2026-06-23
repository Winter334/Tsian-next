/**
 * Shared workspace path normalization. Replaces the three duplicate
 * `normalizePathBase` helpers that lived in `storage/workspace.ts`,
 * `agent-runtime/workspace-operations.ts`, and `agent-runtime/workspace-tools.ts`.
 *
 * The runtime workspace is a root-bound virtual filesystem: there is no parent
 * above the root. Relative segments are therefore safe to resolve here — `..`
 * pops the last segment and clamps at the root (popping an empty stack is a
 * no-op), so a path can never escape the workspace. Accepting `.` and `..`
 * matches the conventions most agent tools train on (e.g. `list(".")` to
 * enumerate the root), avoiding a wasted round on an avoidable
 * `WORKSPACE_PATH_INVALID` error.
 *
 * The core returns a discriminated `NormalizePathResult` rather than throwing:
 * the three call sites wrap failures in their own domain-specific error types
 * (`WorkspaceStorageError` / `workspaceOperationError` / `toolError`), so the
 * core stays free of those dependencies and free of import cycles.
 *
 * Out of scope (kept strict by their own validators):
 * - `agent-runtime/context.ts` authored-config paths (`.`/`..` there usually
 *   signal an authoring typo and are rejected with `null`).
 * - The `MEMORY_MAINTENANCE_SCRIPT_JS` embedded `normalizePath` (a string
 *   literal running in a skill-script sandbox with its own target allowlist).
 */

export interface NormalizePathOptions {
  /** Allow the resolved path to be empty (the root). Directory paths use true;
   *  file paths use false so an empty/`.`-only input reports "required". */
  allowEmpty: boolean
  /** Reject a trailing slash. File paths use true; directory and target paths
   *  use false. */
  rejectTrailingSlash: boolean
}

export interface NormalizePathOk {
  ok: true
  path: string
}

export interface NormalizePathError {
  ok: false
  code:
    | "WORKSPACE_PATH_REQUIRED"
    | "WORKSPACE_PATH_INVALID"
    | "WORKSPACE_FILE_PATH_REQUIRED"
  message: string
}

export type NormalizePathResult = NormalizePathOk | NormalizePathError

function ok(path: string): NormalizePathOk {
  return { ok: true, path }
}

function err(
  code: NormalizePathError["code"],
  message: string,
): NormalizePathError {
  return { ok: false, code, message }
}

/** Normalize a workspace path. See module header for the segment-resolution
 *  rules and the rationale for accepting `.`/`..`. */
export function normalizeWorkspacePath(
  value: unknown,
  options: NormalizePathOptions,
): NormalizePathResult {
  if (typeof value !== "string") {
    return err("WORKSPACE_PATH_REQUIRED", "Workspace path must be a string.")
  }

  const raw = value.trim()
  const hadTrailingSlash = /[\\/]$/.test(raw)
  // Collapse backslashes to forward slashes, strip a leading slash, collapse
  // repeated slashes, and strip a trailing slash. `hadTrailingSlash` is
  // captured before the trailing-slash strip so the file-path guard below can
  // still reject an explicit trailing slash on a non-empty path.
  const collapsed = raw
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .replace(/\/+$/, "")

  // Empty input (including `.`/`./` which collapse to "" after the strips
  // above reach the root via the segment pass — but a truly empty input is
  // settled here before the segment pass).
  if (!collapsed) {
    if (options.allowEmpty) {
      return ok("")
    }
    return err("WORKSPACE_PATH_REQUIRED", "Workspace path is required.")
  }

  // A non-empty path that still carried a trailing slash is a directory-style
  // path; reject it for file paths. Checked before segment resolution so that
  // `a/.` (no trailing slash) is not misjudged — its `.` is dropped in the
  // segment pass, not here.
  if (options.rejectTrailingSlash && hadTrailingSlash) {
    return err(
      "WORKSPACE_FILE_PATH_REQUIRED",
      "Workspace file path must not end with a slash.",
    )
  }

  if (collapsed.includes("\0")) {
    return err("WORKSPACE_PATH_INVALID", "Workspace path must not contain NUL bytes.")
  }

  // Segment resolution: `.` is dropped, `..` pops the last segment (clamping
  // at the root when the stack is empty), empty segments are skipped
  // defensively. Everything else is pushed.
  const stack: string[] = []
  for (const segment of collapsed.split("/")) {
    if (segment === "" || segment === ".") {
      continue
    }
    if (segment === "..") {
      stack.pop()
      continue
    }
    stack.push(segment)
  }

  const path = stack.join("/")
  if (!path) {
    if (options.allowEmpty) {
      return ok("")
    }
    return err("WORKSPACE_PATH_REQUIRED", "Workspace path is required.")
  }
  return ok(path)
}
