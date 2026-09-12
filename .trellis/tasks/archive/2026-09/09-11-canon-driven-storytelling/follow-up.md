# 实测修正：属性基准与角色标题（2026-09-11）

## 最终验收（2026-09-12）

用户复测后确认本次任务圆满结束，0.3.1 后续修正随主任务一并验收、归档；没有剩余待复测事项。下文保留修正决策、工程证据与回归参考。

用户实测确认 0.3.0 主流程无大问题，授权修正两项后续问题。

## 已确认的修复口径

- 属性是游戏规则下的合理估值，不要求原著精确报出数字；不是新增人物前史或世界事实。沿用现有世界维度、力量映射与 ratings，普通相对评价为 5，职业/训练/稳定表现只调整相关维度，极端值需要明确依据。
- 场记负责已知境界或有参照的保守估档；程序不能把缺失 tier 当作最低境界。存在力量体系且需要换算属性时，缺 tier 应明确退回要求补充，而不是静默填最低阶。
- 新建人物由程序补齐全部已定义维度；普通更新只补缺项、保留已存在数值。重复提交同样的评价/境界不应抹掉训练增减或重复计入装备；确有变化的评价/境界才更新相关数值。
- 保留详细 identity.realm；内部计算估档不自动改写成客观境界描述。临时伤病优先进入状态，不自动永久降低基础能力；不按一次骰子输赢反向重估人物。
- 立绘上方仅保留姓名和 role/affiliation/realm 短身份行，缺身份就只显示姓名。完整简介仍在右侧。移动端折叠标题同样不回退长简介，补 Grid/Flex 收缩与长名字约束。
- 不新增预设框架、规划/确认调用或旧存档批量迁移，不改通用注入器、不调用真实 AI、不提交 Git。已有资料只在正常维护触及时补缺。

## 执行与验证计划

1. 修改场记估值指导、确定性补齐与增量计算；同步正常上下文和 lookup 的 tier/level/ratings 语义投影。
2. 修复桌面/移动角色标题及布局。
3. 定向测试默认/部分评价、已知层级、缺层级拒绝、已有数值不变、局部修订与装备一致性；组件渲染及真实浏览器宽度回归。
4. 类型检查、真实卡包/Worker 验证并交付 0.3.1 测试包；保留 0.3.0 历史验证记录，另记这次实际结果。

当前：**修复与工程验证已完成，0.3.1 测试包已交付。**


## 实际修复

- `maintenance-core.js` 在创建/正常维护触及人物时补齐已定义维度，缺省相对评价为 5；已有合法值（包括 0）保留。有力量阶梯而缺少换算所需 tier 时给出明确错误，不静默落到最低阶。
- 局部评价修订只改变对应维度；已保存评价/阶位存在时采用新旧投影差额，保留本局已有永久增减；重复同一评价或阶位不会重新清算整个角色。装备核心只在数值变化后重算贡献，保持固定/百分比装备效果一致，不重复叠加。
- 更换阶梯不继承上一阶的细分等级，内部估档不覆盖详细 `identity.realm`。正常上下文和 lookup 现在都投影既有 tier/level/ratings，便于场记复用而不是每轮猜测。
- 场记 Skill 增加上下文不足时的估值准则；架构师描述维度的普通参照，掷骰 Skill 说明不从单次结果反向改写能力。`docs/属性刻度规范.md` 与实际程序口径同步，没有改造掷骰公式。
- 桌面立绘标题和移动端折叠标题共用 `lib/character-identity.ts`，只取非空 role/affiliation/realm；删除 brief 回退，完整简介仍只在卷宗正文显示。Grid 列及标题/Flex 子项允许收缩，长名字/身份省略显示，不改变实体内容。

## 验证结果

### 确定性测试

最终 **9 文件、76 测试通过**。新增 `character-attributes.test.ts`（9 测试）、`character-header.test.ts`（3 测试），连同原 canon/opening/stage-manager/runtime/bridge 回归一起执行。

```powershell
npm exec vitest run -- apps/platform-web/src/integration/character-attributes.test.ts apps/platform-web/src/integration/character-header.test.ts apps/platform-web/src/integration/canon-storytelling.test.ts apps/platform-web/src/integration/opening-modeling.test.ts apps/platform-web/src/integration/opening-setup.test.ts apps/platform-web/src/integration/stage-manager-maintenance.test.ts apps/platform-web/src/integration/stage-manager-sync.test.ts apps/platform-web/src/integration/assistant-runtime.smoke.test.ts apps/platform-web/src/bridge/remote-iframe-bridge.test.ts
```

覆盖默认与部分评价、较高阶缩放、无力量体系、缺/错阶位拒绝且无半套写入、临时状态不自动永久扣能力、已有训练增减和合法 0 保留、同评价重复提交、局部修订、阶位/等级变化、固定/百分比装备、上下文/lookup、桌面/移动标题无长简介及换人清除旧身份。

### 类型与真实构建/Worker

- `npm exec vue-tsc -- --noEmit -p apps/play-frontend-dev/tsconfig.json`：通过。
- `npm exec vue-tsc -- --noEmit -p apps/platform-web/tsconfig.json`：通过。
- `npm run package:card -- --out tmp/immersive-reader-character-fixes-0.3.1.tsian-card.zip`：通过。真实前端构建、Chrome 平台导出/导入往返、卡资源/初始存档/ZIP 清单与字节校验通过。
- 真实 Skill Worker/Frontend Action Worker 除已有原子提交、失败恢复、名称保护验证外，增加缺省/部分评价补齐与高阶缩放，及跨回合重复估值保留训练增量/装备贡献的检查，均通过。
- `git diff --check`：通过，仅已有 CRLF 等警告。平台业务核心未变化，本次没有重复运行与改动无关的平台完整构建。

### 真实浏览器布局

临时只读预览直接挂载真实 CharacterCard/CharacterStage/CharacterPortrait 等组件，用替身 workspace 客户端隔离玩家存档和 AI。

- 1351×720：简略角色长简介只出现在右侧；立绘居中，标题和立绘宽度均约 409.91px。超长姓名/身份仍不撑宽标题或偏移立绘，页面宽度保持 1351px。
- 390×844：超长姓名/身份的移动折叠标题保持收缩，页面宽度保持 390px；标题区右界 246px，操作按钮左界 262px，无重叠。
- 桌面截图：`tmp/character-header-fix-desktop.png`。临时预览页与服务器已关闭；预览工具栏的编码问题只存在于临时 HTML，已补 charset，不属于卡前端。

## 新测试包

- 卡版本：**0.3.1**。
- 路径：`tmp/immersive-reader-character-fixes-0.3.1.tsian-card.zip`。
- 大小：7,080,585 bytes；297 文件（166 workspace、117 frontend source、13 frontend dist、1 cover）。
- SHA-256：`52ABCFD0B53CECA320514AC95645E000026DFB093C19232A444BD1122D5F6364`。
- 原 0.3.0 包保留，未覆盖。

## 用户复测重点（已验收，保留作回归参考）

1. 新建信息简略的普通 NPC 和境界明确的较强 NPC，检查所有已定义维度是否齐全且层级有区别；不要求凭空展示虚构的精确原著数据。
2. 连续几轮普通维护后，角色已有数值不应随意漂移；状态变化不应自动永久扣减无关基础维度。
3. 角色没有结构化身份、但有长简介时，上方只显示姓名，完整简介在右侧；桌面与移动均不挤坏布局。
4. 本次不批量重估已有存档；已有角色仅在正常维护触及时补缺项，缺换算阶位由场记结合已有材料补充。不要把“打开旧角色页没有立即生成数值”误判为 UI 回写失败。

工程实施与收尾没有真实/付费 AI 调用，也没有 commit/push。0.3.0 主流程与 0.3.1 后续修正均已获用户实测认可；工程证据和用户整体体验反馈分别保留，不把确定性测试当作平衡或剧情质量保证。
## 2026-09-12 提交前整理与再验证

用户要求整理全部未提交改动、提交并推送。提交前再次运行六个业务专项文件，**60 项检查全部通过**，随后按现有 smoke-only 留存策略移除 `canon-storytelling.test.ts`、`character-attributes.test.ts`、`opening-modeling.test.ts`、`opening-setup.test.ts`、`stage-manager-maintenance.test.ts`、`stage-manager-sync.test.ts`。这属于验证完成后的专项清理，不是删除失败断言以掩盖回归；上文历史验证记录仍保留。此前过时的 `character-header.test.ts` 已单独清理。

正式 `test:smoke:web` 保留且 **13 项通过**；标准 `build:web`（含类型检查）、`build:play-frontend` 均通过。`npm run package:card` 再次通过真实无界面 Chrome / Worker 导入、构建、导出及语义开局/维护、原子发布、身份保护、属性和历史回归，生成 `tmp/card-packages/沉浸阅读器-20260912.tsian-card.zip`（297 文件，7,080,587 bytes）。构建产物保持忽略，不提交 ZIP/dist。没有真实 AI 调用。
