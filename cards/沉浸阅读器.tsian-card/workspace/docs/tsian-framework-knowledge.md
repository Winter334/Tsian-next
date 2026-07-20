# Tsian Framework Knowledge

Tsian is an Agent-Orchestrated Runtime platform for AIRP. Platform code owns model configuration, local storage, checkpoints, bridge APIs, execution policy, and sandboxing. Gameplay-specific behavior belongs in workspace files, Agents, Skills, docs, and game frontends.

Runtime Workspace is an effective virtual file system composed from Game Card content plus the active save slot mounted at `save/`. Ordinary workspace paths are visible to Agents, Skills, and game frontends. `.tsian/` is platform-owned metadata and is hidden from ordinary Agent, Skill, and frontend workspace APIs.

The default novel AIRP card uses `storyteller` as the formal player-turn entry Agent. Background specialists are `stage-manager` and `world-architect`.
