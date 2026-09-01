# 拆分 workspace templates 巨型模板文件

## Goal

将 `apps/platform-web/src/storage/workspace-templates.ts` 按默认 workspace 模板、agent、skill、tool、脚本、文档等责任边界拆分，保持默认文件内容与对外行为不变。

## Background / Evidence

- 当前文件约 3674 行 / 257.7 KiB，是本轮最大源码文件。
- 文件内容主要是内嵌 markdown / JSON / JS 脚本 / 默认文件列表，而不是单一算法逻辑。
- Storage spec 明确内置空白卡会 seed 默认 Runtime Workspace 模板；拆分不得改变默认模板内容和非覆盖升级语义。

## Requirements

- R1. 按内容域拆分：agent seed、skill/tool seed、AIRP docs、opening/frontier/maintenance scripts、default file list、runtime default files。
- R2. 保持 `workspace-templates.ts` 的对外 import path 稳定；如可行，原文件降级为 barrel/facade。
- R3. 拆分前生成默认 workspace seed 的内容快照；拆分后比对路径集合和内容，除明确批准外必须完全一致。
- R4. 不改 Dexie schema、不改默认 workspace version、不改升级策略、不改 AI-facing prompt/tool 文本。
- R5. 备份：实现前记录 baseline commit 并创建 `backup/split-workspace-templates-pre-split` 本地备份 ref；每个大内容域移动后保留 patch 检查点或 green build 记录。

## Acceptance Criteria

- [x] `workspace-templates.ts` 不再承载所有模板正文，主要作为公共入口或薄 facade。
- [x] 拆分后的模块命名能从路径看出内容域。
- [x] 默认 workspace 文件路径集合与拆分前一致。
- [x] 默认 workspace 文件内容与拆分前一致，或差异经过单独确认。
- [x] `npm run build:web` 通过。
- [x] 回滚路径已记录：可恢复单个内容域移动或整个 child。

## Out of Scope

- 不重写默认模板内容。
- 不调整内置 Agent/Skill 设计。
- 不改变工作区版本升级策略。
