# 执行计划：开局建模提示词重构与属性刻度规范

## 执行顺序

按「先建知识出处 → 再改引用方 → 最后动脚本与存档模板」推进。每批次结束即为一个回滚点。

**分发前提**：卡内容随卡打包分发，改完即生效，无需登记平台模板数组；只有 `save/**` 仍靠平台自动创建，故仅 `files.ts` 一处需要动平台代码。

**测试立场**：测试为开发让路。逐字锁措辞的断言挡路时直接改或删，不为了让测试变绿而扭曲提示词写法。断真实行为契约的用例保留。

---

### 批次 1 · 建立新的知识出处

产出两份新文档，此时尚无人引用，不影响现有行为。

- [x] 1.1 新建 `cards/沉浸阅读器.tsian-card/workspace/docs/属性刻度规范.md`
  - 按 design.md「属性刻度规范设计」三层结构撰写：绝对锚点 / 维度分类 / 三档曲线
  - 含阶梯映射方法五步、维度可变性护栏五条、自检判据四条
  - 显式覆盖「无力量体系」情形：全员成长维贴近 5，差异由天赋维承担
  - **不得出现任何具体小说的境界名或专有名词**
- [x] 1.2 新建 `cards/.../agents/world-architect/skills/开局建模/workspace-map.md`
  - ref → 文件路径对照表（character / item / container / location / scene / 关系分片）
  - 关系分片完整性规则：每个被引用角色一个 subject 分片；双向关系两边各写一条
  - 「切入点时刻快照」规则
  - 各阶段一次性提交与锁定语义（`OPENING_ENTITIES_LOCKED` / `OPENING_GRAPH_LOCKED` 的实际含义）
  - 字段口径不复制，只给指向 schema guide 的指针
- [x] 1.3 与场记 `stage-manager/skills/回合后维护/workspace-map.md` 逐条比对，确认同一事实无两种说法

**回滚点 A**：删掉两个新文件即完全复原。

---

### 批次 2 · schema guide 去表化

- [x] 2.1 `cards/.../docs/novel-airp-schema-guide.md` 的 `attributes` 段（约 128-144 行）
  - 删除仙侠专用境界数值表
  - 保留：六维字段形状、普通成年人=5 锚点、成长/天赋/混合的分类说明
  - 加指针：具体刻度见 `docs/属性刻度规范.md`
- [x] 2.2 验证无残留：`grep -n "凡人\|开识\|观心\|金丹\|元婴\|大乘" cards/.../docs/novel-airp-schema-guide.md` 应无输出

**回滚点 B**

---

### 批次 3 · `current.md` 模板升级（唯一的平台代码改动）

- [x] 3.1 `apps/platform-web/src/storage/workspace-templates/files.ts:101`
  - 模板文本换为 design.md 的中文空槽位骨架
  - 四类槽位：力量体系阶梯 / 属性档位与区间映射 / 六维定义 / 世界观术语约定，外加结构偏差段
  - 只改该条目的模板字符串
- [x] 3.2 确认题材中性：不含任何小说专有名词
- [x] 3.3 存档创建路径冒烟一次，确认新骨架能正常落盘

**回滚点 C**

---

### 批次 4 · `commit-opening-state.js` 接口扩展

- [x] 4.1 `cards/.../开局建模/scripts/commit-opening-state.js`
  - `input.frontier` 增加可选 `entryAnchorIndex`（1-based）
  - `plotOrder` 取该锚点 order；缺省、非整数或越界时回退 `timeline[0].order`
  - 越界即回退，**不新增失败路径**
- [x] 4.2 确认未触碰 `openingAssertPathSet` / `OPENING_*_LOCKED` 任何逻辑
- [x] 4.3 `SKILL.md` 的 tsian-actions 声明同步 `commit_opening_state` 的 inputSchema

**回滚点 D**

---

### 批次 5 · SKILL.md 重写（核心批次）

按 design.md「SKILL.md 重构后的结构」逐节改。**先按最佳写法写，写完再看测试断哪里，不预先迁就断言。**

- [x] 5.1 工作笔记模板补三栏：已落盘路径 / 世界观口径与刻度 / 切入点对应 source 锚点
- [x] 5.2 执行规则：第一步要求并行读取工作笔记 + `workspace-map.md`；声明实体与场景/关系阶段允许同一次 invocation 连做
- [x] 5.3 §1：移出「切入点时刻快照」规则（已进 workspace-map）
- [x] 5.4 §2 实体阶段
  - 前置条件：先填 `save/schema/current.md` 四类槽位（旧存档无槽位则整体重写该文件）
  - 指向 `docs/属性刻度规范.md`
  - 显式重申切入点快照规则
- [x] 5.5 §3 场景与关系阶段
  - 修正「从 `save/entities/...` 读取权威实体」的误导措辞
  - 补关系完整性规则、声明本阶段一次性且随后锁定
- [x] 5.6 §4 状态阶段：补 `entryAnchorIndex` 说明
- [x] 5.7 §5 首回合正文与发布
  - **删除**对写手选项格式、字数、选项条数的一切复述，改为「以 storyteller 自身输出格式为准」
  - 核对改为五条显式清单，须逐条写出判定结果方可 publish
- [x] 5.8 通读全文，确认 SKILL 内不再出现字段形状、路径字面量、数值刻度
- [x] 5.9 验证：`grep -rn "\[\[选项\]\]" cards/` 应无输出

**回滚点 E**

---

### 批次 6 · 测试跟进

**顺序很重要**：先定稿提示词，再让测试适配，不反过来。

- [x] 6.1 跑 `npm run test:smoke:web`，收集失败断言
- [x] 6.2 逐条判断每个失败断言的性质：
  - **锁措辞的** → 删除该断言（`assistant-runtime.smoke.test.ts:878-881` 的逐字 `toContain` 属此类）
  - **锁行为契约的** → 保留，并检查是不是实现真的错了
- [x] 6.3 `:881` 的 `不复制已在 workspace 中的实体、场景、关系或 runtime 全文` 直接删除——纯文案断言
- [x] 6.4 `:878-880` 的协议标识（`inputRefs.openingReply` / `responseRef` / `opening-interview:continue:<sessionId>`）若新文案自然包含则留，否则删
- [x] 6.5 保留 `:1196-1198` 的 `choices.missing` 用例——它断的是真实行为契约，且是 D1 的佐证
- [x] 6.6 `npm run test:smoke` 全绿

---

### 批次 7 · 全量验证

- [x] 7.1 `npm run build:web`
- [x] 7.2 对照 prd.md 逐条核 AC1~AC12（静态可查项）
- [x] 7.3 派 `code-reviewer` 或 `verifier` 做独立审查（**不自审**）

---

### 批次 8 · 真机验证（AC13，可跨会话）

- [ ] 8.1 导入一部**非仙侠**小说（验证规范的世界观通用性）
- [ ] 8.2 跑完整开局，抓取请求日志
- [ ] 8.3 核对：
  - 第 5 阶段无路径盲搜轮次
  - 关系分片覆盖所有被引用角色
  - 同体系内不同等级角色成长维有可见差值
  - `current.md` 四类槽位均已填写
  - `plotOrder` 指向玩家实际切入点
  - 核对清单在正文中逐条出现

## 验证命令速查

```bash
grep -rn "\[\[选项\]\]" cards/   # 批次 5，应无输出
npm run test:smoke:web           # 批次 6
npm run test:smoke               # 批次 6 收尾
npm run build:web                # 批次 7
```

## Review Gates

| 位置 | 检查内容 |
|---|---|
| 批次 1 后 | 两份新文档是否真的题材中性；与场记 workspace-map 是否有事实冲突 |
| 批次 5 后 | SKILL 是否真的只剩流程与关卡；核对清单是否可观测 |
| 批次 6 | 每条被删的断言是否确属「锁措辞」而非「锁行为」 |
| 批次 7 | 独立 reviewer 审查，不自审 |

## 风险与应对

| 风险 | 应对 |
|---|---|
| 属性规范写得太长，架构师读不完或不照做 | 控制在能三分钟走完的流程；自检判据放末尾且可逐条勾 |
| 三档曲线在无力量体系的题材不适用 | 规范显式写「无力量体系时全员成长维贴近 5，差异由天赋维承担」 |
| 阶段合并后单次输出变大触发截断 | 只合并前两阶段；若真机验证发现截断，退回不合并（改动仅在 SKILL 文本，回滚成本低） |
| 旧存档 `current.md` 无槽位 | SKILL 明确要求：发现无槽位则整体重写该文件 |
| 删断言删过头，漏掉真实回归 | 批次 6.2 逐条分类，只删「锁措辞」类；批次 7 由独立 reviewer 复核删除清单 |
| `files.ts` 改动影响其他游戏卡新建存档 | `current.md` 骨架保持题材中性，只给槽位不给内容 |

---

## 实施记录（2026-08-30）

### 与计划的偏差

1. **批次 2 引发两处悬空引用修复**（删表的直接后果，非范围蔓延）：
   - `frontier推进/SKILL.md:28` 原写「按境界参照 schema guide 示例刻度尺填写」→ 改指 `current.md` + `属性刻度规范.md`
   - `novel-airp-schema-reference.md:50` 「`attributes` 固定6维」→ 改为 4-8 维 + 指针
2. **一度错误地把新卡内文件登记进平台模板，已回退。** `spec/contracts/frontend/type-safety.md` 明确规定内置模板无人维护、不得接受特性同步，「模板看起来也该同步」正是它预判并否掉的动机。对 `apps/platform-web/**` 的改动最终只有 `files.ts` 的 `current.md` 模板文本一处（存档骨架属平台所有，是 spec 允许的例外）。详见 design.md「实施修正：新增卡内文件确实不登记（曾走错一次）」。
3. **批次 4 补了一处 design.md 未预见的清理**：`entryAnchorIndex` 是纯输入字段，需在落盘前从 `frontierFile` 显式 `delete`，否则会被 `{ ...input.frontier }` 带进 `frontier.json`。
4. **批次 6 的失败断言与预测不符**。预测会断的 `:878-881` 一条没断；实际删除的是 `:901` / `:906` / `:907`。详见 design.md「实施结果：预测的四条一条没断」。
5. **顺手修了一处 CSS 注释**里的过期标记（`PlaySetupDialog.vue:213`），使 AC1 的全仓库 grep 干净。

### 代码侧前置确认

`equipment-core.js:125`、`parse-character.ts:99` 均走 `Object.keys` 遍历，`AttributesPane.vue` 渲染 `AttributeCard × N`——**没有任何运行时代码硬编码 6 维**，故属性规范放开到 4-8 维是安全的。

### 验证结果

- `npm run test:smoke:web`：13 passed / 0 failed
- `npm run build:web`：✓ built in 22.41s
- AC1~AC12 静态 grep 全部通过

### 未执行

- **批次 7.3 独立 reviewer 审查**：本会话未派发（会话约束不主动调用 Agent 工具）。
- **批次 8 / AC13 真机验证**：由用户执行。
