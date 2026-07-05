# Design: runtime.worldTime 世界层时间固定字段

## 1. Problem

当前状态栏体系需要稳定展示“当前世界/剧情时间”。已有 schema 示例将“当前时间”放在 `runtime.extensions` 中，但这会让 UI、runtime injection 和场记维护都依赖动态中文 key，无法稳定定位。

本任务将“当前世界/剧情时间”提升为 `save/playthrough/runtime.json` 的固定字段 `worldTime`。它服务剧情理解和玩家扫读，不服务日历计算。

## 2. Decision

`runtime.worldTime` 使用字符串：

```json
{
  "turn": 6,
  "worldTime": "赤明纪十二年三月初七，黄昏"
}
```

- 空字符串 `""` 表示未知、尚未建立或当前不需要展示。
- 模糊时间直接写自然语言，例如 `"黄昏"`、`"翌日清晨"`、`"三日后"`。
- 不引入 `precision`、`calendar`、`year/month/day` 等结构化字段。
- 不把平台时间戳、现实时间或 turn 数混入 `worldTime`。

用户确认理由：该字段主要用于剧情理解，后续不需要做日历运算或其它复杂能力。

## 3. Contract

### 3.1 Runtime shape

目标 runtime 固定字段：

```json
{
  "turn": 0,
  "worldTime": "",
  "activeSceneIds": [],
  "activeScene": null,
  "player": { "character": null, "location": null },
  "inventory": null,
  "status": [],
  "extensions": {},
  "updatedAtTurn": 0,
  "updatedBy": null
}
```

`worldTime` 是 fixed runtime field；`extensions` 仍用于新增/临时时间机制，例如月相、倒计时、诅咒周期、节气规则等。

### 3.2 Required-field enforcement

`worldTime` 进入 `isRuntimeLike` 必检：

- 缺失或非字符串 → `parseRuntime` 返回 `{ runtime: null, error: "load-failed" }`。
- 当前项目无旧存档，不做向后兼容降级。
- 默认模板写 `worldTime: ""`，让 Agent 和前端能看到固定入口；空字符串表示未知/尚未建立当前世界时间。

### 3.3 Opening initialization

`commit_runtime_and_frontier` 接受 `input.runtime.worldTime`：

- 字符串 → `trim()` 后写入。
- 缺失、非字符串 → 写入空字符串。
- 不因 worldTime 缺失或类型错误 fail；时间不是开局成功的硬前置条件。

## 4. Boundaries

### In scope

- 更新默认 save runtime 模板。
- 更新开局 runtime 写入脚本。
- 更新默认卡内 schema guide / schema current / playthrough README / 场记 Skill 指导。
- 更新 play frontend runtime 类型与解析输出。

### Out of scope

- 完整时间系统、日历换算、排序、持续时间计算。
- 状态栏视觉 UI。
- runtime summary injection 实现。
- 旧存档迁移。
- 平台级服务或 Dexie schema 变更。

## 5. File-level Design

### 5.1 `apps/platform-web/src/storage/workspace-templates.ts`

Update these template surfaces together so default cards and new saves stay self-consistent:

- `COMMIT_RUNTIME_AND_FRONTIER_SCRIPT_JS` input comment and runtime write path.
- `runtimeFile` construction: include `worldTime` near `turn`.
- `NOVEL_AIRP_SCHEMA_GUIDE_MD` runtime example: move current time out of `extensions` and into `worldTime`.
- Default `save/schema/current.md` text: document `worldTime` as current story/world time fixed field.
- Default `save/playthrough/README.md`: list `worldTime` alongside `activeSceneIds` and other runtime summaries.
- `STAGE_MANAGER_STATUS_SKILL_MD`: tell the stage manager to maintain `worldTime` as a short narrative string when the story establishes or advances time.
- `DEFAULT_SAVE_RUNTIME_FILES` runtime default: add `worldTime: ""`.

### 5.2 `apps/play-frontend-dev/src/lib/runtime-types.ts`

Add:

```ts
worldTime: string
```

to the `Runtime` interface.

### 5.3 `apps/play-frontend-dev/src/lib/parse-runtime.ts`

Add `worldTime` to `isRuntimeLike` required-field check so a runtime without it is treated as `load-failed`. In `parseRuntime`, read it directly:

```ts
worldTime: raw.worldTime
```

No display item is generated here; fixed fields remain consumed by UI-specific tasks.

## 6. Validation

Required validation after implementation:

- `npm run build --workspace play-frontend-dev`
- `npm run build:web`
- `git diff --check`

If implementation only touches template/docs and play-frontend types, no contracts build is required unless shared contract source changes.

## 7. Rollback

Rollback is straightforward:

- Remove `worldTime` from default runtime template and opening commit script.
- Revert schema guide / README / Skill wording to the previous extension-only example.
- Remove `Runtime.worldTime` and parser required check.

Because the project has no production saves, rollback does not require data migration.
