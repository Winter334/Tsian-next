# 准备两个 SDK 发布

## Goal

Prepare the two public SDK packages for a user-operated npm beta release after
source changes landed after their currently published versions.

## Requirements

- Bump `@tsian/contracts` from `0.2.0-beta.5` to the next beta version.
- Bump `@tsian/play-bridge` from `0.2.0-beta.4` to the next beta version.
- Keep `@tsian/play-bridge`'s `@tsian/contracts` dependency pinned to the new
  contracts beta version.
- Regenerate the workspace lockfile without publishing or pushing.
- Build both packages and inspect npm pack contents/metadata.
- Leave npm authentication, publish verification, and `npm publish` to the
  user.

## Acceptance Criteria

- [x] Package manifests contain the intended next beta versions.
- [x] `package-lock.json` workspace entries resolve the prepared local packages;
      after publication, refresh registry-backed `beta` entries so app-local
      nested installs move off the historical beta.3 records.
- [x] `npm run build:contracts` passes.
- [x] `npm run build:play-bridge` passes.
- [x] `npm pack --dry-run` succeeds for both packages and includes only intended
      distributable files.
- [x] No `npm publish`, git push, or unrelated source changes are performed.

## Release Handoff

Publish in dependency order from the repository root (the commands below are
intentionally left for the user because registry/auth verification is manual):

```bash
npm publish --workspace @tsian/contracts --tag beta --access public
npm publish --workspace @tsian/play-bridge --tag beta --access public
```

Then verify both tags and refresh the registry-backed lockfile entries:

```bash
npm view @tsian/contracts@beta version
npm view @tsian/play-bridge@beta version
npm update @tsian/contracts @tsian/play-bridge --workspaces --package-lock-only --ignore-scripts
npm install --ignore-scripts
```

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
