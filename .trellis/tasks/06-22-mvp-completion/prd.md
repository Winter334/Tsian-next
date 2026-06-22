# MVP Completion: Account + App Market + Assistant Attachments

## Goal

补齐 Tsian MVP 的三个关键缺口，使玩家能够：(1) 在桌面助手中粘贴截图/文件辅助对话；(2) 拥有账号身份；(3) 以账号身份在应用商店上传/下载整卡包作品。

## 背景

当前 Tsian 是纯本地浏览器应用（Vue + Dexie + 浏览器直连 LLM provider）。Go platform-server 是只有 `/healthz` 的占位。无 user/account/auth 概念。`AppMarketView.vue` 是空壳，已有 `importGameCardPackage` / `exportGameCardPackage` 这对 zip 导入导出 API 但上传按钮 disabled。助手消息是 `{role, content: string}`，无附件字段。

## 子任务

1. **06-22-assistant-attachments**（P2，先做）— 助手附件上传，纯本地，不依赖后端
2. **06-22-account-system**（P1，后做）— 账号系统，自建 Go 后端 + Discord OAuth 登录
3. **06-22-app-market**（P1，后做）— 应用商店，整卡包分享，依赖账号系统

## 用户决策记录（2026-06-22）

- **后端方案**：自建 Go 后端，对接 Discord OAuth 登录（不用 BaaS）
- **推进顺序**：先做附件上传（快速交付），再规划账号+市场
- **市场内容**：先做整卡包分享（复用现有 export/import zip 机制），后续再加细粒度 schema 资源（预定义人物、世界设定等）

## 跨子任务验收标准

- [ ] 三个子任务各自独立可验收
- [ ] 附件上传不依赖账号/后端，本地即可工作
- [ ] 账号系统是应用商店的前置依赖（市场上传/下载需要账号身份）
- [ ] 账号+市场共享 Go 后端，架构统一设计

## Out of Scope（本父任务）

- 细粒度 schema 资源市场（预定义人物/世界设定单独分享）——后续版本
- 账号系统的跨设备存档同步——后续版本
- 市场评论/评分/社交功能——后续版本

## Open Questions

- 账号+市场的详细 PRD 在附件上传完成后展开（避免过早设计未定型的后端）
