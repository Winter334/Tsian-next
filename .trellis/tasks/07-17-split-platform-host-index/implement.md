# Implementation Plan: 拆分 platform-host 入口聚合文件

- [ ] Read frontend directory/quality specs before implementation.
- [ ] Record baseline commit and create `backup/split-platform-host-index-pre-split`.
- [ ] Inventory remaining responsibilities in `platform-host/index.ts`.
- [ ] Compare with existing modules before creating new ones.
- [ ] Extract runtime trace helpers if still embedded.
- [ ] Extract resource query handlers if still embedded.
- [ ] Extract workspace action normalization/execution glue if not already in `workspace-ops.ts`.
- [ ] Extract AI invocation queue/adapter if it forms a cohesive seam.
- [ ] Keep `playFrontendBridge` assembly in `index.ts`.
- [ ] Check import cycles and event ordering.
- [ ] Run `git diff --check`.
- [ ] Run `npm run build:web` after each seam.
- [ ] Record compatibility notes.
