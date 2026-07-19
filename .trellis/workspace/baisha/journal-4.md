# Journal - baisha (Part 4)

> Continuation from `journal-3.md` (archived at ~2000 lines)
> Started: 2026-07-18

---



## Session 156: Turn history recall system

**Date**: 2026-07-18
**Task**: Turn history recall system
**Package**: platform-web
**Branch**: `task/turn-history-recall`

### Summary

Implemented card-level turn recall metadata and storyteller history recall skill, moved immersive reader card source from tmp to cards, and added character history display in play frontend.

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `b5947d7` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 157: 长篇小说导入性能优化

**Date**: 2026-07-19
**Task**: 长篇小说导入性能优化
**Package**: platform-web
**Branch**: `feat/long-novel-import-performance`

### Summary

实现长篇小说导入 shard 存储与 Worker 分章构建：新导入写 save/source/shards 与 v2 chapters.index，前端预览和 runtime opening/frontier source reader 支持 shard+旧 path 兼容；确认页章节列表虚拟化并显示导入进度；刷新沉浸阅读器卡包 dist 与 metadata；补充 sharded source corpus code-spec。验证：play-frontend build、platform-web build、skipLibCheck vue-tsc、diff check、卡包 metadata、镜像与 AI-facing stale path 检查通过；完整 vue-tsc 仍受第三方声明问题阻塞。

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `68616e8` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 158: 时间线注入原著剧情节点

**Date**: 2026-07-19
**Task**: 时间线注入原著剧情节点
**Package**: platform-web
**Branch**: `task/07-19-timeline-injection-bg-events`

### Summary

收敛背景事件状态机方案为轻量 timeline 注入；开发前端在发送前读取 frontier timeline，以 user before-input 注入当前 plotOrder 附近原著剧情节点与最近玩家 if 线节点。验证 play-frontend-dev build 通过，tsc 受既有 Vue shim 问题阻塞。

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `a8fce1e` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete
