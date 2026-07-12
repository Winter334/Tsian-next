import type { WorkspaceFile } from "@tsian/contracts"

/**
 * Macro expansion engine for the context injection composer (规则拼接系统).
 *
 * Supports two macros written inside injected file content or inline templates:
 * - `{{file:相对路径}}` — unconditional reference (file content inserted raw)
 * - `{{file:相对路径?enabled}}` — conditional reference (only when the file's
 *   stem is in `enabledModules`; `enabledModules === undefined` → always include)
 * - `{{file:目录/*.md?enabled}}` — glob reference (expand `*`, per-file enabled check)
 * - `{{random:A,B,C}}` — random choice from comma-separated candidates
 *
 * Expansion depth is 1 layer: referenced file content is inserted raw, macros
 * inside it are NOT re-expanded. After all macros are replaced, an implicit
 * whitespace cleanup runs (collapse 3+ consecutive newlines to 2, trim ends).
 *
 * See `.trellis/tasks/07-12-context-injection-composer/design.md` §3.
 */

// {{file:path}} / {{file:path?enabled}} — group 1 = path (may contain `*`),
// group 2 = optional `?enabled` suffix. `[^}?]+` excludes `}` (macro end) and
// `?` (condition marker), so `{{file:}}` (empty path) does not match.
const FILE_MACRO_PATTERN = /\{\{file:([^}?]+)(\?enabled)?\}\}/g
// {{random:A,B,C}} — group 1 = comma-separated candidates. `[^}]+` requires at
// least one non-`}` char, so `{{random:}}` (empty candidates) does not match.
const RANDOM_MACRO_PATTERN = /\{\{random:([^}]+)\}\}/g

export interface MacroExpandOptions {
  /** Relative paths in `{{file:...}}` resolve against this directory
   *  (the injected file's directory, or the agent directory for templates). */
  baseDir: string
  /** Workspace file lookup by normalized path. */
  filesByPath: Map<string, WorkspaceFile>
  /** Enabled module names (file stems). `undefined` = all included (backward compat). */
  enabledModules: string[] | undefined
}

export interface MacroExpandResult {
  /** Expanded text with all macros replaced and whitespace cleaned. */
  content: string
  /** Referenced-but-missing file paths (for missingContextPaths reporting).
   *  Conditional references whose condition is not met are NOT recorded here. */
  missing: string[]
}

/**
 * Validate and normalize a workspace file path. Replicated from `context.ts`
 * (kept here so `macro-engine.ts` is self-contained — `context.ts` imports
 * `expandMacros` from here, so this module must not depend back on context.ts).
 *
 * - Trims and converts backslashes to forward slashes.
 * - Strips leading/trailing slashes and collapses repeated slashes.
 * - Rejects empty paths, trailing-slash paths, and `.`/`..` segments.
 */
export function normalizeWorkspaceFilePath(value: string | undefined): string | null {
  const raw = value?.trim()
  if (!raw) {
    return null
  }

  const hadTrailingSlash = /[\\/]$/.test(raw)
  const normalized = raw
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .replace(/\/+$/, "")

  if (!normalized || hadTrailingSlash) {
    return null
  }

  const segments = normalized.split("/")
  if (segments.some((segment) => segment === "." || segment === ".." || segment === "")) {
    return null
  }

  return normalized
}

/** Extract the file stem (filename without extension) from a workspace path.
 *  `save/agents/storyteller/modules/禁用词表.md` → `禁用词表`. */
function fileStem(path: string): string {
  const base = path.split("/").pop() ?? path
  const dotIdx = base.lastIndexOf(".")
  return dotIdx > 0 ? base.slice(0, dotIdx) : base
}

/** Resolve a `{{file:...}}` relative path against `baseDir`, then validate.
 *  Returns the normalized absolute workspace path, or null if invalid. */
function resolveRelativePath(baseDir: string, relativePath: string): string | null {
  const joined = baseDir ? `${baseDir}/${relativePath}` : relativePath
  return normalizeWorkspaceFilePath(joined)
}

/** Convert a glob pattern (single-level `*` only, no `**`) to a RegExp.
 *  `*` matches any chars except `/`. Returns null if the regex is invalid. */
function globToRegex(pattern: string): RegExp | null {
  const segments = pattern.split("/")
  const regexParts = segments.map((segment) => {
    // Escape all regex special chars except `*` (handled next).
    const escaped = segment.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    return escaped.replace(/\*/g, "[^/]*")
  })
  try {
    return new RegExp(`^${regexParts.join("/")}$`)
  } catch {
    return null
  }
}

/** Expand a glob pattern against the workspace file map. Returns matching files
 *  sorted by path. Only single-level `*` is supported (no `**`). */
function expandGlob(
  pattern: string,
  filesByPath: Map<string, WorkspaceFile>,
): WorkspaceFile[] {
  const regex = globToRegex(pattern)
  if (!regex) {
    return []
  }
  const matches: WorkspaceFile[] = []
  for (const [path, file] of filesByPath) {
    if (regex.test(path)) {
      matches.push(file)
    }
  }
  return matches.sort((a, b) => a.path.localeCompare(b.path))
}

/** Check whether a file is enabled under the `?enabled` condition.
 *  `enabledModules === undefined` → always enabled (backward compat). */
function isFileEnabled(
  path: string,
  enabledModules: string[] | undefined,
): boolean {
  if (enabledModules === undefined) {
    return true
  }
  return enabledModules.includes(fileStem(path))
}

/** Collapse 3+ consecutive newlines to 2 (1 blank line), then trim ends. */
function cleanupWhitespace(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").trim()
}

/**
 * Expand all `{{file:...}}` and `{{random:...}}` macros in `text`.
 *
 * File references resolve relative to `options.baseDir`, are validated via
 * `normalizeWorkspaceFilePath`, and inserted raw (no recursive expansion).
 * Conditional (`?enabled`) references whose stem is not in `enabledModules`
 * are replaced with empty and NOT recorded as missing. Glob (`*`) references
 * expand to matching files, each checked for enabled status; zero matches is
 * not an error (not recorded as missing).
 *
 * After all macros are replaced, implicit whitespace cleanup runs.
 */
export function expandMacros(
  text: string,
  options: MacroExpandOptions,
): MacroExpandResult {
  const missing: string[] = []

  // 1. Expand {{file:...}} macros (single pass, no recursion).
  let result = text.replace(
    FILE_MACRO_PATTERN,
    (match: string, rawPath: string, enabledSuffix: string | undefined): string => {
      const trimmedPath = rawPath.trim()
      if (!trimmedPath) {
        return match // empty path after trim — preserve original
      }
      const hasEnabled = enabledSuffix !== undefined

      if (trimmedPath.includes("*")) {
        // Glob reference — expand matching files, check enabled per file.
        const resolvedPattern = resolveRelativePath(options.baseDir, trimmedPath)
        if (!resolvedPattern) {
          return ""
        }
        const matchedFiles = expandGlob(resolvedPattern, options.filesByPath)
        const parts: string[] = []
        for (const file of matchedFiles) {
          if (hasEnabled && !isFileEnabled(file.path, options.enabledModules)) {
            continue
          }
          parts.push(file.content) // raw insert, no recursive expansion
        }
        // Glob zero-match is not recorded as missing.
        return parts.join("\n\n")
      }

      // Single file reference.
      const resolvedPath = resolveRelativePath(options.baseDir, trimmedPath)
      if (!resolvedPath) {
        return ""
      }
      if (hasEnabled && !isFileEnabled(resolvedPath, options.enabledModules)) {
        // Condition not met — skip, do not record as missing.
        return ""
      }
      const file = options.filesByPath.get(resolvedPath)
      if (file) {
        return file.content // raw insert, no recursive expansion
      }
      // File missing (unconditional, or conditional with condition met).
      missing.push(resolvedPath)
      return ""
    },
  )

  // 2. Expand {{random:A,B,C}} macros.
  result = result.replace(
    RANDOM_MACRO_PATTERN,
    (match: string, candidates: string): string => {
      const items = candidates
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean)
      if (items.length === 0) {
        return match // empty candidates — preserve original
      }
      // Cache warning: each expansion may differ → prefix cache miss.
      return items[Math.floor(Math.random() * items.length)]!
    },
  )

  // 3. Implicit whitespace cleanup.
  result = cleanupWhitespace(result)

  return { content: result, missing }
}
