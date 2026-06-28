# Local Patches to Trellis Upstream Files

> **Purpose**: Track patches we applied to files owned by the Trellis package
> (`@mindfoldhq/trellis` / `@mindfoldhq/trellis-core`). These files are
> **overwritten on `trellis update`** and need to be re-applied after an
> upgrade or on a fresh checkout that re-syncs Trellis. Each entry has a
> self-contained re-apply procedure so a new device or a Trellis upgrade can
> be patched in minutes.
>
> Files here are NOT managed by Trellis. This document is user-owned and
> survives `trellis update` (Trellis only manages the blocks it generated).

---

## Archived Patch 1 — ZCode session-identity fallback in `active_task.py`

**File**: `.trellis/scripts/common/active_task.py`
**Applied**: 2026-06-21
**Removed**: 2026-06-28 after switching current work to Codex.
**Backup**: `.trellis/.backup-2026-06-28-zcode-fallback-removal/active_task.py.with-zcode-fallback`
**Current status**: Not applied. Keep this entry only as a re-apply recipe if
ZCode is used again and upstream still lacks an equivalent cwd-derived
session fallback.

**Symptom**: `task.py start` prints "degraded mode" and never persists the
per-session active-task pointer under ZCode. `.trellis/.runtime/sessions/`
stays empty; `task.py current` always reports no active task.

### Root cause

ZCode is an OpenCode-derived host (its `config.json` uses the
`opencode.ai/config.json` schema). Trellis ships an OpenCode adapter that
reads `OPENCODE_SESSION_ID` / `OPENCODE_RUN_ID` from the shell environment,
but ZCode does not export those. The Claude Code `CLAUDE_ENV_FILE` bridge
that upstream SessionStart hooks rely on to hand the context key to later
bash commands is also absent. So every identity source in
`resolve_context_key()` fails and `task.py start` degrades.

### Fix

Add a ZCode-specific fallback in `resolve_context_key()`: when ZCode is
detected (via `ZCODE_APP_VERSION` / `ZCODE_ENV` / `ZCODE_RUNTIME_ENV`) and
all upstream identity sources miss, derive a stable per-repo context key
from cwd: `zcode_<ZCODE_PROCESS_LABEL>_<repo_hash>` (label optional).
`task.py` (AI-run bash) and hook subprocesses resolve the same key for a
given repo, closing the hook→bash identity gap.

Multi-window same-repo sessions share a key and overwrite each other's
pointer — same single-session assumption as
`_resolve_single_session_fallback`, and a strict improvement over the
never-persists state on ZCode.

### How to verify

```bash
cd <repo>
python -X utf8 -c "import sys; sys.path.insert(0,'.trellis/scripts'); from common.active_task import resolve_context_key; print(resolve_context_key())"
# expect: zcode_local-1_<hash>   (non-None)
python -X utf8 .trellis/scripts/task.py start <some-planning-task>
# expect: ✓ Current task set ... Source: session:zcode_...   (NO "degraded mode")
ls .trellis/.runtime/sessions/   # expect: zcode_*.json present
python -X utf8 .trellis/scripts/task.py finish
```

### Re-apply after Trellis upgrade / on a new device

1. Open `.trellis/scripts/common/active_task.py`.
2. Insert two helpers (`_detect_zcode`, `_zcode_cwd_context_key`) right
   before `def resolve_context_key(`. See the code block below.
3. In `resolve_context_key`, change the cursor-ticket branch from
   unconditional `return` to fall-through, then add the ZCode fallback.
   See the diff block below.
4. Run the verify steps above.

#### Helper code to insert (before `def resolve_context_key`)

```python
def _detect_zcode() -> bool:
    """Detect ZCode (an OpenCode-derived host) from the process environment.

    ZCode forks OpenCode but does not export OpenCode's session env vars
    (`OPENCODE_SESSION_ID` / `OPENCODE_RUN_ID`), and the Claude Code
    `CLAUDE_ENV_FILE` bridge that upstream hooks rely on to hand the context
    key back to later bash commands is also absent. Without a session identity
    `task.py start` falls into degraded mode and never persists the per-session
    active-task pointer. This detector enables a cwd-derived fallback below.
    """
    return bool(
        _string_value(os.environ.get("ZCODE_APP_VERSION"))
        or _string_value(os.environ.get("ZCODE_ENV"))
        or _string_value(os.environ.get("ZCODE_RUNTIME_ENV"))
    )


def _zcode_cwd_context_key() -> str | None:
    """Derive a stable context key from the repo root under ZCode.

    ZCode does not expose session identity to shell subprocesses, so we derive
    a per-repo key from the working directory: `zcode_<repo_hash>`, optionally
    namespaced by `ZCODE_PROCESS_LABEL` when the host sets it (window
    distinction). Both `task.py` (AI-run shell command) and hook-launched
    subprocesses resolve to the same key for a given repo, closing the
    hook→bash identity gap that otherwise forces degraded mode.

    Multi-window same-repo sessions share a key and overwrite each other's
    pointer — same single-session assumption as
    `_resolve_single_session_fallback`, and a strict improvement over the
    current never-persists state on ZCode.
    """
    repo_root = _find_repo_root_from_cwd()
    if repo_root is None:
        return None
    repo_hash = _hash_value(str(repo_root))
    label = _string_value(os.environ.get("ZCODE_PROCESS_LABEL"))
    if label:
        safe_label = _sanitize_key(label)
        if safe_label:
            return f"zcode_{safe_label}_{repo_hash}"
    return f"zcode_{repo_hash}"
```

#### Diff to apply inside `resolve_context_key`

```diff
     if platform_name in (None, "session", "cursor"):
-        return _lookup_cursor_shell_ticket_context_key()
+        cursor_key = _lookup_cursor_shell_ticket_context_key()
+        if cursor_key:
+            return cursor_key
+
+    # ZCode fallback: ZCode is an OpenCode derivative that does not export
+    # OpenCode's session env vars and lacks the CLAUDE_ENV_FILE bridge, so
+    # every upstream identity source above fails. Derive a stable per-repo
+    # key from cwd so `task.py start` can persist the session pointer instead
+    # of degrading. See `_zcode_cwd_context_key` for the multi-window caveat.
+    if _detect_zcode():
+        return _zcode_cwd_context_key()
     return None
```

> **Note on the cursor branch change**: the original code did
> `return _lookup_cursor_shell_ticket_context_key()` unconditionally when
> `platform_name in (None, "session", "cursor")`. Under ZCode,
> `platform_name` is `None` (no platform detected), so execution entered
> that branch and returned `None` directly — the ZCode fallback below it
> was unreachable. Changing it to "return only if a ticket was found" lets
> control fall through to the ZCode fallback. This is safe for Cursor too:
> when a valid ticket exists it still returns early; when none exists it
> previously returned `None` anyway, so falling through changes nothing for
> Cursor.

---
