# Skill 配置机制

> **注**：此任务原名"助手联网搜索能力"，经需求探索后转为 skill 配置机制（联网 skill 集后续回头做）。任务目录名保留旧名。

## Goal

给 skill 加一套声明式配置机制：skill 声明它需要哪些配置项（`.env` 风格 key-value），平台 UI 渲染配置输入框，玩家填值保存，skill 脚本运行时通过 `tsian.config` 拿到配置值。

这是 skill 体系的基础设施升级——不只服务于联网 skill（搜索 API key / Reader API key / SearXNG 地址），任何需要玩家配置的 skill 都能用。

## User Value

- **skill 能依赖玩家配置**：skill 脚本能用 `config.API_KEY` 等配置值，不必硬编码 key（导出 skill 不泄露密钥）
- **玩家有正规配置入口**：UI 上看到 skill 需要哪些配置，填值保存，不用编辑脚本源码或 JSON 文件
- **联网 skill 的前置基础设施**：后续做 web-search / page-reader / vendor-import skill 时，API key 通过这套机制配置，skill 脚本直接用

## Confirmed Facts（已通过代码探明）

- **skill 目录结构**：`skills/<skillId>/SKILL.md` + `scripts/*.js` + 可选 `lib/*.js`（vendor）。`skill.config` 放同目录下，与 SKILL.md 平级。
- **skill 路径识别**：`registry.ts` 用正则 `SHARED_SKILL_FILE_PATH_PATTERN`（`^skills/([^/]+)/SKILL\.md$`）和 `AGENT_LOCAL_SKILL_FILE_PATH_PATTERN` 识别 SKILL.md。`skillPathInfo()` 提取 `directoryPath`（如 `skills/my-skill`）。
- **registry 构建**：`buildSkillRegistry(files)` 遍历所有 workspace 文件，对每个匹配 SKILL.md 路径的文件调 `buildSkillRegistryEntry`。`skill.config` 文件不会被现有正则匹配——需要额外识别逻辑。
- **skill 元数据解析**：`buildSkillRegistryEntry` 用 `parseMarkdown` 解析 SKILL.md frontmatter（`metadataString`/`metadataArray`）。但配置声明不走 frontmatter（避免每次注入 agent context 造成噪声）——用独立文件 `skill.config`。
- **skill 脚本执行**：`browser-skill-script-executor.ts` 的 `BROWSER_SCRIPT_WORKER_SOURCE` 里 `tsian` 对象注入到 Worker。加 `tsian.config` 就是在这个对象上加一个属性，值从主线程传入。
- **配置值传入 Worker**：Worker 消息协议是 `{type:"execute", source, input}`。配置值可加到 execute 消息里（`{type:"execute", source, input, config}`），Worker 内注入 `tsian.config`。
- **现有配置存储参考**：AI provider preset 的 apiKey 存 IndexedDB（`config/ai.ts`），按 provider id 索引。skill 配置值同模式——按 skill name/path 索引存 IndexedDB。
- **skill 执行器注入点**：`assistant-chat.ts:462-467` 注入 `runInspectFrontend`/`runBrowserScript`。配置值在 `createBrowserSkillScriptRunner` 时从存储读出，传入 executor。

## Requirements

### 已定（来自用户对齐）

- **配置声明格式**：`.env` 风格 key-value 文件 `skill.config`，放在 skill 目录下与 SKILL.md 平级。带注释说明每个 key 是什么（`# Tavily API key, get from https://tavily.com`）。声明与默认值合一——文件里写的值就是默认值，玩家覆盖后存自己的值。
- **配置声明不进 agent context**：`skill.config` 是独立文件，不随 SKILL.md 注入 agent。零噪声——配好了 agent 不需要看配置声明，第一次没配置出错再配是正常流程。
- **不做复杂表单控件**：不需要 select/number/password 等 schema 类型系统。全是 key-value，UI 渲染文本输入框。密码类 key（含 KEY/SECRET/TOKEN/PASSWORD）输入框用 `type="password"` 遮蔽——根据 key 名自动判断，不需声明。
- **配置值存储**：玩家覆盖值存 IndexedDB（Dexie），按 skill path 索引。允许 DB schema 升级（破坏性变更，不必拘泥 meta 表，可用专门表）。
- **配置值消费**：`tsian.config` 平铺对象注入 Worker，skill 脚本 `config.API_KEY` 直接取。类型转换交给脚本（`Number(config.MAX_RESULTS)`）。
- **skill.config 是 workspace 文件**：和 SKILL.md/scripts 同 scope（card-content），资源管理器可见、玩家可直接编辑、助手 agent 可 `tsian.workspace.read/write` 编辑、随 skill 包导出。
- **两层配置**：skill.config（workspace 文件）= 声明 + 默认值（可见/可编辑/随包导出）。玩家覆盖值存 Dexie 本地（不进 workspace/不随包导出）。运行时合并：玩家覆盖值优先于 skill.config 默认值。玩家两种配置方式共存：直接改 skill.config 文件（改默认值/声明）或 UI 填覆盖值（不污染文件）。
- **联网 skill 集搁置**：本任务只做配置机制基础设施，不做 web-search/page-reader/vendor-import skill。后续回头做。

### 待探索

（需求探索已收敛，剩余为 design 阶段技术细节）

## Acceptance Criteria

### 配置声明
- [ ] skill 目录放 `skill.config` 文件（`.env` 风格 key-value + 注释），registry 能解析出配置项列表。
- [ ] `skill.config` 不存在时 skill 正常加载（无配置需求）。
- [ ] 配置项含 key、默认值、注释说明。注释（`#` 开头行）被解析为该项的描述。
- [ ] `skill.config` 是 workspace 文件（card-content scope），资源管理器可见。
- [ ] 玩家能在资源管理器直接编辑 `skill.config`（改默认值/加 key/删 key）。
- [ ] 助手 agent 能 `tsian.workspace.read/write` 读写 `skill.config`（和其他 workspace 文件一致）。
- [ ] `skill.config` 随 skill 包导出（含声明 + 默认值，不含玩家覆盖值）。

### 配置存储（玩家覆盖值）
- [ ] 玩家在 UI 填的覆盖值存 IndexedDB（Dexie），按 skill path 索引。
- [ ] 玩家覆盖值不进 workspace（不随 skill 包导出，防密钥泄露）。
- [ ] 运行时合并：玩家覆盖值 > skill.config 默认值。

### 配置消费
- [ ] skill 脚本运行时 `tsian.config` 是平铺对象，含玩家配置值（或默认值）。
- [ ] 玩家未配置的 key 用 `skill.config` 里的默认值。
- [ ] skill 脚本能 `config.API_KEY` 取值并在 fetch 调用里用。

### UI
- [ ] skill 详情页根据 `skill.config` 渲染配置输入框（每个 key 一个）。
- [ ] key 名含 KEY/SECRET/TOKEN/PASSWORD 时输入框用 password 类型遮蔽。
- [ ] 玩家填值保存后，下次打开显示已填值（password 类型可显示遮蔽占位）。
- [ ] 无 `skill.config` 的 skill 不显示配置区域。

### 工程质量
- [ ] vue-tsc 类型检查通过（`npm run build:web`）。
- [ ] 不破坏现有 skill 加载/执行机制（use_skill/run_script 路径不变）。
- [ ] 现有 skill（无 skill.config）行为不变。

## Out of Scope

- 联网 skill 集（web-search / page-reader / vendor-import）——后续任务。
- 复杂表单控件（select/number/conditional）——.env 风格全是 key-value。
- 配置项 schema 验证（类型校验/必填校验）——skill 脚本自己处理缺失/类型错误。
- 配置值加密存储——IndexedDB 明文存（和 AI provider apiKey 同级别）。
- skill 配置的导入/导出——导出 skill 包只含 `skill.config` 声明+默认值，不含玩家配置值。

## Open Questions

（需求探索已收敛，以下为 design 阶段技术细节）

- `skill.config` 解析逻辑放 registry.ts 还是独立模块？（design 定）
- 配置值存储的 IndexedDB schema 设计。（design 定）
- `tsian.config` 注入的精确位置（Worker 消息协议扩展 vs executor 侧拼接）。（design 定）
- 配置 UI 放 skill 详情页哪个位置。（design 定）
