# Technical Design

## Task Map

```text
Parent: deterministic-equipment-frontend-actions
├── card-frontend-action-runtime
│   └── generic card-owned frontend execution surface
└── deterministic-equipment-management
    └── schema + action + Stage Manager Skill + UI
```

子任务按顺序实施。装备子任务依赖 `tsian.card.runAction`、事务提交和通知契约，不自行绕过平台能力。

## Cross-Child Contract

Frontend Action 的有效 Workspace 路径为：

```text
frontend-actions/<action-id>/action.json
frontend-actions/<action-id>/<executor files>
```

卡包磁盘路径自然为 `workspace/frontend-actions/**`。固定目录是唯一发布源，不加入 game-card manifest 字段。

装备子任务发布 action id `equipment`，输入区分 preview/commit 与 equip/unequip。Stage Manager Skill 不调用 Frontend Action，也不通过 Agent Registry 复用脚本；shared equip/unequip operations 以相同业务 Schema、公式、错误码和 vectors 保持一致，Skill-only refresh 使用独立 result schema/vectors。

## Integration Sequence

1. Frontend Action Runtime 扩展 contracts、play-bridge、remote bridge、host registry/executor、storage commit 和文档/规范。
2. 子任务独立验证固定目录、Agent 隔离、权限、rollback、CAS、abort、no-checkpoint 和远程权限回归。
3. Equipment Management 直接切换 Schema，增加卡内 Action/Skill，并更新开发前端；该 child 允许在 formal packaged frontend 仍未导入时独立归档。
4. 装备子任务用前一子任务提供的测试 harness 执行 shared equip/unequip parity 与 Skill-only refresh vectors，并完成开发前端浏览器验收。
5. 正式卡 frontend 仍按既有“开发前端可后续导入”边界处理；父任务在 later frontend import/build/export 后，确认正式 packaged carrier 实际调用已发布 Action 才能完成。

## Shared Invariants

- Frontend Action 使用前端 actor 权限，只能持久化 save-runtime。
- Action 所有读取依赖与最终提交属于同一乐观并发契约。
- 装备一次提交只写一个角色文件，不移动容器内容，不创建检查点。
- Action 成功通知发生在 durable commit 之后。
- Checkpoint restore 和 Frontend Action mutation 都必须使相关实体读取失效，不能只依赖 runtime.updatedAtTurn。

## Rollback

- Runtime 子任务可独立回滚桥 method/registry/executor，不影响现有 Skill/Tool。
- Equipment 子任务在 Runtime 稳定后实施；其 Schema 尚未上线，不保留兼容分支。
- 任一子任务失败时不开始下一任务；父任务保持 planning/integration 状态。
