# Tsian 此间

Tsian 此间是一个 AIRP 专精框架。

当前项目方向已经收敛为：

- 平台与工坊由官方后端和平台 WebUI 提供
- 玩家游玩运行时默认在平台 WebUI 本地执行
- 官方平台负责模组与游玩前端包分发
- 玩家存档默认本地存储

当前仓库骨架：

- `apps/platform-server`
- `apps/platform-web`
- `packages/contracts`
- `packages/runtime-core`
- `builtin/play-frontends/official-default`
- `builtin/mods`
- `docs`

进一步的架构与技术决策见：

- [docs/system-architecture-skeleton.md](/F:/workspace/Tsian/docs/system-architecture-skeleton.md)
- [docs/development-skeleton.md](/F:/workspace/Tsian/docs/development-skeleton.md)
- [docs/technical-stack-skeleton.md](/F:/workspace/Tsian/docs/technical-stack-skeleton.md)
