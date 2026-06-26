# Implement — 拆分 agent-runtime/workspace-tools.ts

## Seam 1: 提取 workspace-tools-types.ts

- [ ] 脚本基于标记提取 25-360（锚：`export interface RuntimeWorkspaceToolCall {` 起，`const TOOL_CALL_PATTERN =` 止）
- [ ] 内部 interface/type/const/function 加 export
- [ ] 主文件删除该段，barrel re-export 原 24 public 符号
- [ ] build → 根据 "Cannot find name" 补 import 内部符号
- [ ] `npm run build:web` green
- [ ] commit

## Seam 2（待评估）: 解析层

- [ ] Seam 1 green 后评估 parse/strip/extract 是否可干净切出

## 验收
- [ ] build green
- [ ] 导出面等价（35 符号）
- [ ] class identity：此文件无 class export，无 instanceof 风险
- [ ] 消费方导入未改动
