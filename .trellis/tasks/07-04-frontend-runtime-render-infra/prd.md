# 前端 runtime 读取与渲染基础设施

## Goal

在 `apps/play-frontend-dev` 中建立读取 `save/playthrough/runtime.json`、解析固定字段与动态扩展字段、并提供预设渲染能力的前端基础设施，供左侧状态栏、角色卡、容器/物品详情和 runtime injection 复用。

## Requirements

- R1: 通过 `@tsian/play-bridge` / `useTsian` 提供的 `tsian.workspace.*` 读取 runtime 和必要实体文件，不直接使用裸桥协议或 RPC method 字符串。
- R2: 提供 runtime 状态读取 composable 或等价数据层，支持 ready 后初次加载、turn 结束后刷新、检查点恢复后刷新。
- R3: 解析固定基础字段与 `extensions` / `扩展` 字段，归一为前端内部 display item 结构。
- R4: 支持有限预设渲染类型：文本、数字、进度、标签、列表、段落、引用/实体入口、卡片组等。
- R5: 未知 render、缺失值、读取失败时优雅降级，不中断游玩。
- R6: 基础设施不硬编码动态玩法字段含义，只硬编码固定基础 schema 和渲染类型。
- R7: 后续 UI 组件可复用同一套解析结果，避免状态栏、角色卡、injection 各自重复实现解析逻辑。

## Acceptance Criteria

- [ ] 能读取并解析 `save/playthrough/runtime.json`。
- [ ] 能识别固定字段与扩展字段。
- [ ] 能把扩展字段按 render 类型归一成 display items。
- [ ] 提供可复用的基础 renderer 或 display item 输出，供 UI 任务使用。
- [ ] 检查点恢复或历史重载后可刷新数据。
- [ ] 未知/非法字段有降级路径。
- [ ] 通过 `npm run build --workspace play-frontend-dev`。

## Dependencies

- 依赖 `.trellis/tasks/07-04-renderable-runtime-entity-schema` 明确数据约定。
