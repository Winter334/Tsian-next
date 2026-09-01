# Account Center Window

## Goal

把账号入口从桌面 taskbar 的直接 Discord 登录按钮升级为一个 RetroOS 风格的“账号中心”桌面窗口。用户在窗口内查看登录状态、理解登录/绑定含义，并点击“使用 Discord 登录”后才跳转 OAuth。当前不实现账密登录 / 注册 / 邮件邀请，但 UI 和文案要为后续 `password` / `email_magic_link` identity 扩展留出位置。

## Parent

- `.trellis/tasks/06-22-mvp-completion`

## Background

账号系统任务 `06-22-account-system` 已完成并归档：

- Go 后端已支持 Discord OAuth、server-side session、mock-login、SQLite `users + auth_identities + sessions`
- `auth_identities` 当前只创建 `provider="discord"`，后续可新增 `password` / `email_magic_link`
- platform-web 已有 `authApi` / `useAuth` / `User` contract
- 当前 UI 仍是 `DesktopShell.vue` taskbar 上的“Discord 登录”按钮，点击直接跳 `/api/v1/auth/login`

## Requirements

- R1: 新增桌面应用“账号中心”（建议 appId `account`，route `/account`，view `AccountView.vue`），通过现有 DesktopShell/DesktopWindow 体系打开。
- R2: taskbar 账号区域点击后打开账号中心窗口，而不是直接跳 Discord OAuth。
- R3: 未登录状态：展示账号说明、当前登录方式（Discord）、“使用 Discord 登录”按钮；按钮点击后才调用 `authApi.login()` 跳转 OAuth。
- R4: 已登录状态：展示头像、displayName、handle、已绑定登录方式（`authProviders`），提供“退出登录”。
- R5: UI 预留后续登录方式区域：账密登录 / 邮箱邀请 / Magic Link 作为“即将开放”或 disabled 项，不实现后端逻辑。
- R6: 保持本轮账号系统边界：不新增 password identity、不做注册、不做邮件发送、不做账号资料编辑 API。
- R7: 继续使用现有 `useAuth` 和 `authApi`，不重复实现登录状态。
- R8（视觉与交互方向：操作员身份终端）：账号中心以”操作员身份终端”为概念落地，复用 RetroOS 既有视觉语言（`retro-inset` / `retro-button` / `selection-tile` / `glow-text` / 凹斜面阴影 / 直角 / JetBrains Mono / CRT 调性），不引入新色板或新字体。
  - R8.1 状态条：未登录显示 `NO OPERATOR SIGNED IN`（磷光呼吸动画，`glow-text` 风格）；已登录显示 `OPERATOR ONLINE`（低饱和绿色点缀，不新增色板变量可用现有 `neon` 降亮度）。
  - R8.2 身份区：头像放入凹斜面方框（缺失 `avatarUrl` 时用 `UserRound` 占位）；`displayName` 作为主名大字；`handle` 以 mono 小字呈现为 `OP-ID: <handle>`；下方一行简短说明（未登录讲”登录后同步游戏卡/存档”，已登录讲”游戏卡与存档将同步到云端”）。
  - R8.3 凭证槽位纵列：每个登录方式一行槽位（图标 + 名称 + 右侧状态/动作）。
    - Discord：未登录时高亮可点，右侧”使用 Discord 登录 ▶”（点击调 `authApi.login()`）；已登录时显示”✓ 已绑定”。
    - 账号密码 / 邮箱邀请 / Magic Link：始终 disabled，右侧”即将开放”标签，dashed 边框 + 灰阶。
  - R8.4 退出登录：已登录态在槽位列表末尾放”⏻ 退出登录”按钮，危险色（`--color-danger`），点击调 `useAuth().logout()` 并 toast 反馈。
  - R8.5 动效克制：仅状态条磷光呼吸（CSS keyframes，遵守 `prefers-reduced-motion`），不做窗口入场/槽位逐项动画。

## Acceptance Criteria

- [ ] AC1: 桌面上存在”账号中心”应用入口，能打开 AccountView 桌面窗口
- [ ] AC2: taskbar 账号区域点击打开账号中心，不直接跳 OAuth
- [ ] AC3: 未登录窗口显示状态条 `NO OPERATOR SIGNED IN` + 说明 + “使用 Discord 登录”按钮，点击后跳 `/api/v1/auth/login`
- [ ] AC4: 已登录窗口显示头像、displayName、`OP-ID: <handle>`、authProviders（Discord 标”已绑定”），并可退出登录
- [ ] AC5: 账密 / 邮箱邀请 / Magic Link 以 disabled + “即将开放”形式出现，明确后续支持但当前不可用
- [ ] AC6: `npm run build:web` 通过
- [ ] AC7: 视觉复用既有 RetroOS 类与色板，未引入新字体/新色板变量；状态条磷光呼吸遵守 `prefers-reduced-motion`

## Out of Scope

- 自建账号密码登录实现
- 邮件邀请 / magic link 后端实现
- 修改账号资料（handle/displayName/avatar）API
- 市场上传/下载逻辑
