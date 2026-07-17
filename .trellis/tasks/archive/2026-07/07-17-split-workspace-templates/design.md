# Design: 拆分 workspace templates 巨型模板文件

## Split Shape

推荐目标结构：

```text
apps/platform-web/src/storage/workspace-templates/
  index.ts
  constants.ts
  files.ts
  agents/
    researcher.ts
    storyteller.ts
    stage-manager.ts
    world-architect.ts
  docs/
    airp.ts
    framework.ts
  scripts/
    opening.ts
    frontier.ts
    maintenance.ts
```

`workspace-templates.ts` 可保留为兼容 facade：从目录模块 re-export 原有公共导出。

## Content Equivalence

拆前生成 snapshot：

- 默认文件路径列表。
- 每个默认文件 content 的 hash。
- runtime default card path / save runtime file path 相关集合。

拆后必须比对 snapshot。若有差异，除纯换行归一化且明确接受外，应视为失败。

## Rollback

- Baseline branch: `backup/split-workspace-templates-pre-split`。
- Patch checkpoints: 按 `agents`, `docs`, `scripts`, `file-list` 分片。
