# Capability: contracts (delta)

> 由 OPSX change `prompt-preset-and-workflow-engine` 修改的既有 capability。`packages/contracts` 是跨包 TS 类型契约层。

## 1. New Module: `workflow.ts`

```ts
// packages/contracts/src/workflow.ts

export type WorkflowNodeType =
  | 'ai-call'
  | 'result'
  | 'switch'
  | 'apply-patch'
  | 'compute';

export interface WorkflowDefinition {
  id: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  config: NodeConfig;
  retry?: { max: number; backoffMs: number };
}

export interface WorkflowEdge {
  from: { nodeId: string; port: string };
  to: { nodeId: string; varName: string };
}

export type NodeConfig =
  | AiCallNodeConfig
  | ResultNodeConfig
  | SwitchNodeConfig
  | ApplyPatchNodeConfig
  | ComputeNodeConfig;

export interface AiCallNodeConfig {
  presetRef: string;
  modelRef: string;
  appendUserInput?: boolean;
}

export interface ResultNodeConfig {
  name: string;
  value: NodeOutputExtractRule;
}

export interface SwitchNodeConfig {
  condition: string; // §13.2 字面量等值
}

export interface ApplyPatchNodeConfig {
  pushCheckpointReason?: string;
}

export interface ComputeNodeConfig {
  source: string;
  timeout?: number;
}

export interface NodeOutputDeclaration {
  name: string;
  type: 'string' | 'json' | 'messages';
}

export type NodeOutputExtractRule =
  | { fromPort: string }
  | { literal: string }
  | { jsonPath: string };
```

## 2. `ApplyPatchOutput` (re-export from runtime contracts)

```ts
export interface ApplyPatchOutput {
  appliedArchives: string[];
  appliedEventIds: string[];
  globalsChanged: boolean;
  currentTimeChanged: boolean;
}
```

字段命名严格对齐 apply-patch 节点的 4 个端口（`§13.3`）。

## 3. `ModManifest` Extension

```ts
export interface ModManifest {
  id: string;
  // ... existing fields ...

  // NEW
  workflow?: WorkflowDefinition;
  presets?: PresetInfo[];
  customMacros?: Record<string, string>;

  // INTENTIONALLY NOT EXTENDED:
  // customNodeTypes — HC-13 在编译期禁止：节点类型集合是平台特权
}
```

模组**不可**注册新节点类型。`apply-patch` 节点若出现在 mod manifest 内，必须在加载期 reject（HC-13、`§13.4` 项 5）。

## 4. Re-exports

`packages/contracts/src/index.ts` 增加：

```ts
export * from './workflow';
```

## 5. Behavior Contract

- 类型仅声明，无运行时代码
- 任何对 `WorkflowNodeType` 联合的扩展必须同时在以下三处发生（编译期硬约束）：
  1. `packages/contracts/src/workflow.ts`
  2. `packages/workflow-engine` validate + dispatch
  3. `apps/platform-web/src/workflow-host` 节点实现注册
- 缺少任一处都会触发 TS 编译错误（exhaustive switch 检查）

## 6. Cross-references

- design.md §4（NodeOutputExtractRule）、§7（manifest）、§12.1（ApplyPatchOutput）、§13.4
- _research-notes.md HC-13

## 7. Out of Scope
- 序列化协议（工作流目前以 TS 字面量 / JSON 加载，无版本号）
- 类型至 JSON Schema 生成
