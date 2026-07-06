# Implementation Plan: roll_dice 工具对抗扩展

## Preconditions

- PRD 已收敛到 `roll_dice` Tool 对抗扩展。
- `design.md` 已定义输入 / 输出 / 互斥校验 / 边界。
- 本任务只改默认 Tool 种子，不改 Agent / Skill / registry。

## Files to inspect / edit

- `apps/platform-web/src/storage/workspace-templates.ts`
  - `tools/roll_dice/tool.json` seed
  - `tools/roll_dice/run.js` seed

Likely read-only context:

- `apps/platform-web/src/platform-host/browser-skill-script-executor.ts`
  - `tsian.lib.random.dice` 现有契约：校验 sides/count/modifier，处理 advantage/disadvantage，返回 `{ rolls, kept, modifier, total }`。
- `docs/reference/tool-vs-skill.md`
  - Tool / Skill 边界说明；本任务不需要更新，除非实现中发现文档与 `roll_dice` 新契约冲突。

## Steps

1. Update `tool.json` seed
   - 更新 `description`，说明支持单方 DC 检定与双方对抗，二者互斥。
   - 新增 `opposed` object schema：`sides`、`count`、`modifier`、`advantage`、`disadvantage`。
   - 保留 `additionalProperties: false` 与现有字段。
   - 在 `dc` / `opposed` description 中写清互斥关系。

2. Update `run.js` seed
   - 新增 `isRecord` / `invalidArgs` / `normalizeNumber` / `rollOnce` 等小 helper（保持脚本自包含）。
   - 在任何随机调用前检查 `dc` 与 `opposed` 互斥。
   - 明确校验顶层 `modifier` 与 `opposed.modifier` 为 finite number。
   - `opposed.sides` / `opposed.count` 缺省继承顶层配置。
   - 对抗时计算并返回 `opposed`、`margin`、`winner`。
   - 平局返回 `winner: "tie"`，不重投、不强制裁决。
   - 保留 `reason` 和现有单方 `dc` / `success` 行为。
   - `tsian.trace` 对抗路径补充 `opposedTotal`、`margin`、`winner`。

3. Validate formatting / type checks
   - 运行仓库现有前端检查命令（优先根据 package scripts 选择最小必要命令）。
   - 若没有专门单测，至少运行 TypeScript / lint / build 中能覆盖 `workspace-templates.ts` 的检查。

4. Manual behavior check if practical
   - 由于 `roll_dice/run.js` 是 workspace 种子中的字符串脚本，不一定有直接单测入口。
   - 如无现成 harness，可通过抽取脚本逻辑到临时 Node 执行片段验证：
     - 单方 `dc` 路径返回 `success`。
     - `opposed` 路径返回双方 totals / margin / winner。
     - 相等 totals 返回 `tie`（可 stub `tsian.lib.random.dice`）。
     - `dc + opposed` 在调用随机前抛错。
     - 非数字 modifier 抛错。
   - 临时验证脚本不提交。

5. Update task manifests
   - `implement.jsonl` 加入真实 spec / docs context。
   - `check.jsonl` 加入真实 spec / docs context。
   - 移除 `_example` seed 行。

6. Review gate
   - 向用户汇报 PRD / design / implement 已就绪。
   - 经用户批准后运行 `task.py start` 进入 Phase 2。

## Validation commands

待进入实施前根据 `package.json` / workspace scripts 确认。候选：

- `pnpm --filter platform-web typecheck` 或仓库等价命令。
- `pnpm --filter platform-web test`（若存在）。
- 若缺少细粒度命令，运行现有前端构建 / 类型检查命令。

## Risks

- `workspace-templates.ts` 中 Tool 脚本是字符串数组，编辑容易出现转义 / 逗号 / 引号错误；验证必须覆盖 TypeScript 编译。
- `Number(value)` 会把 `""` 转成 0；实现应避免空字符串 modifier 被静默接受。建议 `normalizeNumber` 对 string trim 后为空的值报错。
- `opposed` 为空对象时继承顶层 `sides/count` 并使用 modifier 0，是合法最小对抗。
- 如果 `opposed.sides/count` 传入非法值，错误由 `tsian.lib.random.dice` 抛出，错误码为 `TSIAN_LIB_RANDOM_INVALID_ARGS`。这是可接受的底层参数错误。

## Rollback points

- 若实现破坏现有单方检定，回滚 `workspace-templates.ts` 中 `tools/roll_dice/tool.json` 与 `tools/roll_dice/run.js` 的修改。
- 不涉及数据迁移；默认种子变化只影响后续新建 / 重建 workspace 内容。
