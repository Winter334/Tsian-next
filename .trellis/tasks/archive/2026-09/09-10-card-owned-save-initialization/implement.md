# 执行记录与验证计划

## 当前结果：已完成

前置清理于 2026-09-10 完成。33 项相关测试、contracts/platform 构建、真实浏览器卡包导入与初始存档/checkpoint 验证通过。产物：`tmp/immersive-reader-cleanup.tsian-card.zip`。下文按讨论与实施顺序保留历史；早期“尚未实施”不是当前状态。后续任务链已完成，并于 2026-09-12 随[原著驱动任务](../09-11-canon-driven-storytelling/implement.md)获用户最终验收后结项归档；本记录不再表示主任务尚未开始。

## 2026-09-10：已完成的规划工作

- [x] 建立独立前置任务，与场记转型任务建立双向关系。
- [x] 核实真实 packager 同时读取卡 workspace 与 `apps/play-frontend-dev/src`。
- [x] 追踪新建存档仍无条件使用 DEFAULT_SAVE_RUNTIME_FILES，且定义混在旧 templates 目录中。
- [x] 识别 workspace 缺省文件升级路径、卡资源 save/.tsian 禁区、runtime manifest 归一化需要联动。
- [x] 记录“声明式目录模板优先、脚本按真实计算需要引入”的建议与未决合同。

尚未开始：实现、删除旧模板、资产搬迁、构建、打包和运行测试。旧存档迁移已明确排除，不是待做工作。主任务仍为 planning；本任务已设为本会话当前任务，工具将状态改为 in_progress，仅表示正在进行前置分析/设计，不代表业务实现已启动。

下一步：设计已确认，按 prd.md 的最终合同沿真实入口补齐实施文件清单，然后进行前置任务实现；无需再研究旧卡兼容或迁移策略。不要重新从卡 frontend/src 副本推断当前行为，也不要一口气删除 workspace-templates 目录。

## 源码入口

- `scripts/package-immersive-reader-card.mjs`：权威输入、保留路径检查、manifest 键校验。
- `cards/沉浸阅读器.tsian-card/card-manifest.json`
- `packages/contracts/src/game-card.ts`：卡 runtime 与包合同。
- `apps/platform-web/src/storage/game-cards.ts`：manifest 归一化、卡内容路径、内置空白卡。
- `apps/platform-web/src/storage/game-card-packages.ts`：包导入/导出。
- `apps/platform-web/src/storage/saves.ts`：createLocalSaveFromGameCard。
- `apps/platform-web/src/storage/workspace.ts`：默认生成、补文件升级。
- `apps/platform-web/src/storage/workspace-templates/files.ts`
- `apps/platform-web/src/storage/workspace-templates/constants.ts`
- `apps/play-frontend-dev/src/composables/useSetupState.ts`：旧初始状态识别依赖。
- `apps/play-frontend-dev/src/composables/useSyncAfterTurn.ts`：真正的维护调用文案。
- `cards/沉浸阅读器.tsian-card/workspace/agents/world-architect/skills/开局建模/scripts/_opening-workflow.js`

## 计划验证

实现后按 `.trellis/spec/guides/validation-strategy.md` 选择命令。候选证据：
- 合同与归一化、包 round-trip 单测；未配置/空模板/非法模板分支。
- 两张不同 schema 的卡新建存档隔离，平台 metadata 不被卡覆盖。
- 创建失败与 checkpoint 一致性；模板静态资产不被写回。
- 新卡更新不覆盖旧存档；默认升级不重新灌入 AIRP 文件。
- 真实 `npm run package:card` 产物导入后新建存档、沉浸阅读器开局运行。
- 受影响 contracts/platform/card frontend 构建；测试不能只依赖已废弃模板夹具。

本轮只有任务文档/元数据写入，验证文档、引用和依赖关系即可；没有执行上述业务验证，不能报告为通过。

## 本轮记录验证

- 两任务 task.json 可解析，双向前置依赖一致，Markdown 本地链接与 relatedFiles 均存在。
- `task.py list` 可发现两个任务；会话指针指向本前置任务。
- `git diff --check` 通过；已有工作区修改未改动。任务文档是新文件，另已直接检查 UTF-8、内容和引用；未运行业务测试。

## 2026-09-10：承载方向获确认

用户认可声明式配置加初始文件树，要求讨论待确定内容。已将推荐方向转为已确认记录，未把具体字段名称或旧卡策略标为已批准。进一步核对 `.tsian/manifest.json` 的平台归属及初始 checkpoint 流程；记录“空目录不独立入包”的合同细节。仍只有任务文档/元数据改动，未实现新协议。

## 2026-09-10：具体合同与简化约束确认

用户认可上一轮待议合同，并明确只有一张官方卡、尚处测试阶段。已更新 PRD/design：使用 `runtime.initialSave.templateRoot`、原样目录复制、空业务兜底、声明空目录报错、仅新建初始化；不做兼容/迁移/双轨逻辑。沉浸阅读器随本任务同步更新。主任务也已记录测试阶段简化约束。

此轮仍仅更新任务记录，未开始业务实现。下一步的工作是实现，不再把兼容问题作为待用户决策项。

## 2026-09-10：开始实施（用户已明确要求）

实施顺序：
1. 加入 `runtime.initialSave.templateRoot` 合同与共用校验/实例化，贯穿两处 manifest 归一化、卡保存/导入和新建存档。
2. 将现行 AIRP 初始业务文件原样迁入卡 `workspace/initial-save/`，平台仅生成内部元数据；删除默认补业务文件路径。
3. 内置空白卡变为真正空白卡；现用 smoke/equipment 验证改读真实卡资产，移除确认无消费者的旧模板目录。
4. 补初始化/隔离/失败/checkpoint/包往返测试，跑受影响构建与真实打包。
5. 按结果更新任务和所用知识；主任务仍不开始。

风险重点：两处 manifest 归一化漏字段；无配置/非法配置混淆；包虚拟目录前缀和目标路径冲突；旧自动升级回灌；空白卡残留 AIRP 入口；测试仍使用废弃副本。原有用户的 platform-host 与 Studio 修改保持不动。

## 2026-09-10：实现与验证结果（已完成）

### 已实现

- 新增合同 `GameCardInitialSaveConfig` 与 `runtime.initialSave.templateRoot`。
- `storage/save-initialization.ts` 集中处理声明、模板路径/资源/冲突校验、原样实例化和独立平台元数据；没有玩法 schema 解释或脚本钩子。
- 两处 manifest 归一化、卡保存/导入/导出、新建存档均接入该合同。初始化文件与初始 checkpoint 使用同一批数据。
- 原平台 29 个 AIRP 初始业务文件原样迁入官方卡 `workspace/initial-save/`；官方 manifest 声明目录。平台无配置只创建 `.tsian/manifest.json`，不生成业务文件。
- 删除旧 `createDefaultSaveRuntimeFiles`、默认业务文件版本升级/回灌路径；重新打开不会补写或套用模板。
- 新建 builtin blank 卡无 AIRP Agent、Skill、入口和业务文件；占位前端改为通用创作说明，不再声称等待小说前端接入。
- smoke 世界架构师测试与装备脚本夹具改读正式卡资产；删除已无活跃引用的 15 个 workspace-templates 文件。
- 删除卡目录中 116 个旧 frontend/src、frontend/dist 与生成包清单副本；它们没有当前打包/运行消费者且删除前未被用户修改。添加卡 README 明确真正前端来源为 `apps/play-frontend-dev/src`。
- 修正实际前端类型文件的旧模板来源注释；更新本次使用的 storage、contracts 与 AIRP 原则 10 知识。
- 强化真实浏览器打包 harness：导出/导入后创建存档，校验 29 个业务文件 + 1 个平台文件、初始 checkpoint 与卡源文件不变。打包器必须收到初始化验证成功结果才发布产物。

### 验证

- `npm run build:contracts`：通过。
- `npm run build:web`：通过；仅有现有 Rollup 注释/分块体积警告。
- `npm exec vitest run apps/platform-web/src/storage/save-initialization.test.ts apps/platform-web/src/integration/assistant-runtime.smoke.test.ts apps/platform-web/src/bridge/remote-iframe-bridge.test.ts`：3 文件、33 测试通过。
- 新初始化测试涵盖不解释/不展开内容、非法声明/路径、空模板、重复与文件目录冲突、两个最小 schema 夹具隔离、多存档隔离、初始 checkpoint/回溯、无配置空白卡、卡更新不改旧档、非法包不落盘、源资产被删除后拒绝新建、包往返以及官方 29 文件。
- 真实 `npm run package:card -- --out tmp/immersive-reader-cleanup.tsian-card.zip` 已在沙箱外获批准后成功：300 文件（162 workspace、118 frontend source、19 frontend dist、1 cover），7,137,351 bytes；平台真实导入 round-trip 与初始存档检查通过。最终增加 CLI 强制校验回传结果后再次打包通过。
- zip 独立检查：声明为 `initial-save`，包含 29 个初始文件，逐字节匹配卡源码，无 `workspace/save/` 或 `workspace/.tsian/` 运行数据泄漏。
- `git diff --check`：通过。用户原有 AGENTS、.gitignore、state-management、journal、Studio 和 platform-host 修改未动。

### 过程中修正

- 第一次类型检查发现简化 builtin 分支后仍访问已被排除的 existing，已移除旧参数访问。
- 第一轮新测试错误地通过普通工作区 API 写平台元数据，被真实边界拒绝；改为测试 fixture 直接设置 DB 行，不放松平台保护。
- 沙箱内 Chromium GPU 进程无法启动；按权限流程升级执行，未修改平台浏览器安全设置，沙箱外完整打包成功。

### 明确未做

没有进入场记语义化主任务，没有修改模型提示词/回合维护语义，没有添加旧卡兼容/存档迁移层，没有自动更改现有用户存档，没有上传工坊或 Git 提交。没有调用外部模型跑完整剧情；本次验证重点是初始化/打包/开局脚本与结构消费者。

最终核对：CLI 已强制检查浏览器 `initialSaveRegression` 回传，最终打包成功；contracts/platform 最后一次构建成功；文档/依赖引用检查和 diff whitespace 检查通过。无需兼容/迁移工作，未保留此类后续待办。
