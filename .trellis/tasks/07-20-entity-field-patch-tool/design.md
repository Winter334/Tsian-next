# Design — 实体字段局部更新工具

## 1. Boundary

该能力属于沉浸阅读器卡的实体维护规则，而不是平台通用存储语义：

- entity 文件继续是唯一权威数据；Tool 不创建第二份状态。
- 平台现有 `workspace.read` / `workspace.write` 已足够，Tool 只封装安全的 read → patch → compare → write 流程。
- Tool 放在当前卡共享路径 `workspace/tools/update_entity/`，避免为场记和世界架构师复制两份实现。
- 本任务不把实现同步进默认 workspace template。

## 2. Tool files and visibility

新增：

```text
workspace/tools/update_entity/tool.json
workspace/tools/update_entity/run.js
```

Agent 可见性：

- `stage-manager` 当前使用 `tools.enabled` 白名单，加入 `tools/update_entity/tool.json`。
- `world-architect` 当前 `tools.enabled` 为空且仅禁用 `roll_dice`，共享 Tool 会按现有注册规则自动可见；保留这一默认发现机制，不把它改成单项白名单。
- `storyteller` 将 `update_entity` 加入 `tools.disabled`，阻止共享写工具进入正式正文回合。

## 3. Input contract

```ts
type UpdateEntityInput = {
  ref: string
  patch: Record<string, FieldPatch>
}

type FieldPatch =
  | JsonPrimitive
  | { [field: string]: FieldPatch }
  | { $set: JsonValue }
  | { $unset: true }
  | { $append: JsonValue[] }
  | { $upsert: Array<{ match: Record<string, JsonValue>; value: Record<string, JsonValue> }> }
  | { $remove: Array<JsonPrimitive | Record<string, JsonValue>> }
```

`tool.json` 用 JSON Schema 暴露 `ref` 与 `patch`，并在 description 中给出操作符语义。复杂的互斥、危险 key 和目标类型校验由 `run.js` 完成，避免把无法可靠表达的递归约束伪装成浅层 schema。

## 4. Patch interpreter

### 4.1 Classification

对每个 patch 节点按以下顺序分类：

1. 数组：拒绝，提示使用显式数组操作或 `$set`。
2. JSON primitive / `null`：执行 set。
3. record 且含 `$` 开头 key：必须恰好有一个受支持操作符且没有其他 key，然后执行对应操作。
4. 普通 record：递归 patch 对象字段。

所有遍历入口先拒绝危险 key：

```text
__proto__
prototype
constructor
```

### 4.2 Object recursion

- 当前值缺失时，以空对象作为递归基底。
- 当前值为 record 时复制后递归修改。
- 当前值为 primitive、数组或 `null` 时拒绝隐式类型替换；调用方应使用 `$set`。
- 子字段 `$unset` 删除自己的属性；根 `id` 的 set/unset 均被拒绝。

### 4.3 Array operations

`$append`：

- 目标缺失时使用空数组；目标非数组时报错。
- 对每个候选值做结构化深比较；已存在则跳过，否则追加深拷贝。

`$upsert`：

- 目标缺失时使用空数组；目标非数组时报错。
- `match` 和 `value` 必须是安全 record，`match` 不得为空。
- 只匹配数组中的 record；条件中的每个字段都使用结构化深相等。
- 0 个匹配：追加浅合并后的 `{ ...match, ...value }`。
- 1 个匹配：保持旧项其他字段，将 `value` 浅合并进去。
- 多个匹配：抛错，整个调用不写入。

`$remove`：

- 目标缺失时 no-op；目标非数组时报错。
- primitive 条件使用结构化深相等。
- record 条件必须非空；数组项需是 record 且满足全部字段。
- 删除所有满足任一 remove 条件的项。

### 4.4 `$set` and `$unset`

- `$set` 接受任意安全 JSON 值，并以深拷贝设置当前字段。
- `$unset` 的值必须严格为 `true`。
- 不使用 `null` 作为删除标记。

## 5. Validation and atomicity

执行顺序：

```text
validate input/ref
  → derive entity path
  → read original file
  → parse and validate entity object/id
  → deep-clone entity
  → apply entire patch in memory
  → compare original and next
  → no-op return OR guarded write
```

任何错误都发生在 write 之前。Tool 不捕获并降级 patch 错误；它返回带 code/message/details 的结构化异常，供 Agent 修正调用。

路径约束：

- `ref` 只允许一个冒号分隔的非空 `type` 与 `localId`。
- 两段均拒绝空白、`/`、`\\`、NUL、`.`、`..`。
- 唯一推导路径为 `save/entities/${type}/${localId}.json`。

## 6. Write behavior

读取使用 `scope: "save-runtime"`，确保只更新存档权威实体而不是卡内同名只读资源。

写入：

```js
await tsian.workspace.write({
  scope: "save-runtime",
  path,
  content: JSON.stringify(nextEntity, null, 2) + "\n",
  mediaType: "application/json",
  expectedContent: originalContent,
})
```

`expectedContent` 防止在 Tool 读取之后、写入之前同一实体内容已经变化时静默覆盖。它不改变平台现有提交级并发模型。

## 7. Result and trace

No-op：

```json
{
  "status": "unchanged",
  "ref": "character:夏倾月",
  "path": "save/entities/character/夏倾月.json",
  "changed": false,
  "changedPaths": []
}
```

Changed：

```json
{
  "status": "updated",
  "ref": "character:夏倾月",
  "path": "save/entities/character/夏倾月.json",
  "changed": true,
  "changedPaths": ["brief", "goals.current", "history", "status"]
}
```

`changedPaths` 记录发生实际变化的逻辑字段路径；数组操作记录数组字段本身，不回传整个实体。trace 记录 ref/path/status/changedPaths，不记录完整内容。

## 8. AI-facing guidance

保持常驻说明简洁：

- 已存在实体的小范围事实变化使用 `update_entity`。
- 新实体和批量素材提交仍走现有 Skill action。

Tool description 自包含地说明操作符及最小示例；AGENT.md / 回合后维护 Skill 只说明选择边界，不重复整份操作符手册。

## 9. Packaging and rollback

`game-card.json.workspaceFiles` 增加两个共享 Tool 文件，并同步本次修改资源的 size 元数据。

回滚只需移除 Tool 文件、Agent 可见性与提示词引用，并从 manifest 删除对应项；不会迁移或改写已有存档数据。
