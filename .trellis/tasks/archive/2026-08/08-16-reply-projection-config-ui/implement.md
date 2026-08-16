# 正文处理桌面应用 Implementation Plan

## Step 1 — Shared draft codec and controller

- [ ] 新建 `apps/platform-web/src/controllers/reply-projection/reply-projection-draft.ts`，实现 v1 known-field 草稿、extras 保留、structured representability、稳定 JSON 序列化和 rule/project client keys；正则与管道表达式保持原字符串，不新增向导式转换。
- [ ] 新建 `apps/platform-web/src/controllers/reply-projection/use-reply-projection-controller.ts`，负责 active card、读取/创建/保存、expectedContent、dirty/readOnly/unsupported、规则 CRUD/排序、事件刷新和 close guard。
- [ ] 从 `platform-host` barrel 暴露既有 `REPLY_PROJECTION_CONFIG_PATH` / `REPLY_PROJECTION_SCHEMA` 常量；不改 projector 行为。
- [ ] 复用 `getPlatformActiveGameCard`、`readPlatformWorkspaceFile`、`writePlatformWorkspaceFile`、平台事件、Workspace 事件、`confirmChoice` 和 window close guard；不新增专用 Host/存储 API。

Review gate: 对照“沉浸阅读器”配置检查一次 load → structured → serialize，确认 `text: ""`、`display: ""`、`project` 和未知字段无损。

## Step 2 — Register the independent desktop application

- [ ] 在 `apps/platform-web/src/platform-apps.ts` 注册 launcher app：appId/route `reply-projection`、路径 `/reply-projection`、标题“正文处理”、singleton identity，以及 retro/spatial lazy components。
- [ ] 选择现有 lucide 图标并设置与编辑表单匹配的默认/最小窗口尺寸。
- [ ] 保持桌面 shell、窗口 identity 和 route chrome 由现有 registry/shell 管理，不新增第二层窗口标题栏。

## Step 3 — Retro presentation

- [ ] 新建 `apps/platform-web/src/views/ReplyProjectionView.vue`。
- [ ] 用现有 retro toolbar/inset/statusbar 与 `components/ui` 原语实现紧凑规则摘要、“匹配 / 文本替换 / 数据投影”三段详情、保存/刷新、打开配置文件和空/错误/只读/unsupported 状态。
- [ ] “编辑配置文件”路由到既有 Workspace 编辑器；规则排序至少提供可聚焦的上移/下移按钮。
- [ ] 确保空字符串 replacement、字段 presence 和 project key `[]` 不被模板 truthiness 吞掉。

## Step 4 — Spatial presentation

- [ ] 新建 `apps/platform-web/src/spatial/apps/reply-projection/SpatialReplyProjectionView.vue`。
- [ ] 复用 spatial app primitives/style，接入同一 controller，保持三段式信息层级与 retro 对等。
- [ ] 窄窗口使用 master/detail segment 或 stack 布局，保证规则列表、详情和状态操作可达。

Review gate: 两套 view 不复制读写、草稿转换、dirty/conflict 或 rule mutation 逻辑；这些只能存在于共享 controller/helper。

## Step 5 — Manual contract and edge review

- [ ] 用当前 `cards/沉浸阅读器.tsian-card/workspace/config/reply-projection.json` 做真实 round-trip，确认内容语义无变化。
- [ ] 人工覆盖：无 active card、缺配置、只读内置卡、invalid JSON、unsupported unknown shape、Workspace 编辑入口、existing expectedContent conflict、active card dirty switch、close save/discard/cancel。
- [ ] 人工覆盖 rule CRUD/复制/排序、`text`、`content`/`display` presence、空字符串、empty project、`key[]`、完整 value-pipe 和完整 regex literal。
- [ ] 检查 UI 文案只描述作者可见结果，不暴露 Agent scope、projector 内部执行阶段或开发决策。

## Step 6 — Verification

- [ ] `npm run build:web`
- [ ] `npm run test:smoke:web`
- [ ] `git diff --check`
- [ ] 在 retro 与 spatial 下分别打开应用，完成宽/窄窗口人工验收；记录 build 不代表 UI 验证。

## Risk and Rollback Points

- Draft codec 风险最高：若无法证明 unknown fields/presence 无损，停在 unsupported 状态并引导到 Workspace 编辑器，不做猜测性转换。
- Active-card/Workspace 事件可能与 self-save 竞争：先更新 baseline 再 emit，脏草稿永不自动 refresh。
- 若新 app 注册导致 route/window identity 问题，可独立回滚 registry + views，controller/helper 不影响运行时。
- 不修改 `projectAssistantReply`；任何 projector diff 都视为范围漂移并回退。
