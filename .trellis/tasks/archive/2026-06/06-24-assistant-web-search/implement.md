# Implement — Skill 配置机制

## 验证命令

```bash
npm run build:contracts && npm run build:web
npm run dev  # 端到端验证
```

## 风险文件 / 回退点

- **新增**：`apps/platform-web/src/storage/skill-config-storage.ts`（配置值存储 API）
- **改动**：`apps/platform-web/src/agent-runtime/registry.ts`（config 解析 + registry entry）
- **改动**：`apps/platform-web/src/platform-host/browser-skill-script-executor.ts`（tsian.config 注入）
- **改动**：skill 详情页组件（UI 渲染配置输入框）—— 需先确认组件位置
- **可能改动**：`apps/platform-web/src/contracts` 或本地类型（SkillRegistryEntry 加 configItems）
- **回退**：revert 上述文件，meta 表 `skill-config:*` 记录变死数据（不影响功能）

## 有序实现 checklist

### 阶段 A：skill.config 解析 + registry 集成

- [ ] **A1** 新增 `parseSkillConfig(source: string): SkillConfigItem[]` 函数（registry.ts 或独立小模块）：
  - 按行遍历，`#` 开头记 pendingDescription，`KEY=VALUE` 产出 item，空行清空 pendingDescription
  - 返回 `[{ key, description, defaultValue }]`
- [ ] **A2** 新增 `SKILL_CONFIG_FILE_PATH_PATTERN` 正则，识别 `<directoryPath>/skill.config`。
- [ ] **A3** `buildSkillRegistry` 改为先扫一遍建立 `directoryPath → configFileContent` 映射，再在 `buildSkillRegistryEntry` 里查配 + parseSkillConfig。
- [ ] **A4** `SkillRegistryEntry` 加可选字段 `configItems?: SkillConfigItem[]`（contracts 或 registry 本地类型）。
- [ ] **A5** `npm run build:web` 验证类型检查通过。
- [ ] **A6** 确认 `skill.config` 作为 workspace 文件（card-content scope）自动满足可见性：资源管理器能 list/read 它（和其他 workspace 文件同路径，不需额外接入）。
- **验证门**：build 通过 + skill.config 能被解析 + 无 skill.config 的 skill 不受影响 + skill.config 在资源管理器可见。

### 阶段 B：配置值存储（专门表 + DB 升级）

- [ ] **B1** `db.ts` 加 `LocalSkillConfigRecord` 接口 + `skillConfigs` 表 + DB version 升级（v9→v10，破坏性，旧库抛弃）。
- [ ] **B2** 新增 `apps/platform-web/src/storage/skill-config-storage.ts`：
  - `readSkillConfig(skillPath): Promise<Record<string, string>>` — 读 skillConfigs 表，JSON.parse values，不存在返回 `{}`
  - `writeSkillConfig(skillPath, values): Promise<void>` — JSON.stringify 写 skillConfigs 表
  - `deleteSkillConfig(skillPath): Promise<void>` — 删 skillConfigs 记录
- [ ] **B3** 确认 DB 升级不破坏现有功能（v10 新建库，现有数据如 game cards 需重新种子/导入——prototype 模式可接受）。
- [ ] **B4** `npm run build:web` 验证。
- **验证门**：build 通过 + 存储 API 能读写 + DB 升级正常。

### 阶段 C：tsian.config 注入

- [ ] **C1** `browser-skill-script-executor.ts` Worker 源码 `tsian` 对象加 `config` 属性：`config: Object.freeze(message.config ?? {})`。
- [ ] **C2** `runWorkerScript` 签名加 `config?: Record<string, string>` 参数，postMessage 时带上。
- [ ] **C3** `createBrowserSkillScriptRunner` 在调 runWorkerScript 前：读 `request.skillPath` 对应的玩家配置值 + 合并 configItems 默认值 → mergedConfig。
- [ ] **C4** 合并逻辑：`{ ...Object.fromEntries(configItems.map(i => [i.key, i.defaultValue])), ...playerValues }`。
- [ ] **C5** `npm run build:web` 验证。
- **验证门**：build 通过 + tsian.config 注入正确（无配置时是 {}，有配置时含值）。

### 阶段 D：UI 渲染

- [ ] **D1** 确认 skill 详情页组件位置（可能是 skill 列表/详情的 Vue 组件）。
- [ ] **D2** skill 详情页根据 `skill.configItems` 渲染配置区域：
  - 无 configItems → 不显示
  - 有 configItems → 每项渲染 label（description）+ input
  - isSecretKey 判断 → password / text 输入框
  - 初始值 = 玩家已存值 ?? 默认值（需 async load）
- [ ] **D3** 保存按钮 → `writeSkillConfig(skillPath, values)`。
- [ ] **D4** `npm run build:web` 验证。
- **验证门**：build 通过 + UI 能渲染配置输入框 + 保存能写存储。

### 阶段 E：端到端验证

前置：dev server + 一个带 skill.config 的测试 skill。

- [ ] **E1** 创建测试 skill（workspace 写一个带 `skill.config` 的 skill 目录）：
  ```
  skills/test-config/SKILL.md  （现有 skill 模板）
  skills/test-config/skill.config:
    # Test API key
    TEST_API_KEY=
    # Max items
    MAX_ITEMS=5
  skills/test-config/scripts/test.js:
    return { hasKey: typeof config.TEST_API_KEY, maxItems: config.MAX_ITEMS, configKeys: Object.keys(config) }
  ```
- [ ] **E2** UI 验证：skill 详情页显示 2 个配置输入框（TEST_API_KEY password 遮蔽 + MAX_ITEMS text），填值保存。
- [ ] **E3** 助手 use_skill + run_script 跑测试 skill → 脚本拿到 `config.TEST_API_KEY`（玩家填的值）+ `config.MAX_ITEMS`（玩家值或默认 5）。
- [ ] **E4** 未配置时跑 → `config.TEST_API_KEY` 是默认值（空字符串），`config.MAX_ITEMS` 是 "5"。
- [ ] **E5** 无 skill.config 的现有 skill → UI 不显示配置区域，`tsian.config` 是 {}，行为不变。
- [ ] **E6** 资源管理器能看到 `skills/test-config/skill.config`，玩家能直接编辑它（改默认值），编辑后 registry 重新解析出新的 configItems。
- [ ] **E7** 助手 agent 能 `tsian.workspace.read("skills/test-config/skill.config")` 读到内容、`tsian.workspace.write(...)` 改它（和其他 workspace 文件一致）。
- [ ] **E8** 导出 skill 包含 `skill.config`（声明+默认值），不含玩家覆盖值（Dexie 存的不导出）。
- **验证门**：8 场景全通过。

### 阶段 F：工程质量门

- [ ] **F1** `npm run build:contracts && npm run build:web` 全绿。
- [ ] **F2** git diff 确认改动范围（新增 skill-config-storage.ts + 改 registry/executor/UI 组件）。
- [ ] **F3** 不破坏现有 skill 加载/执行（use_skill/run_script 不变）。
- [ ] **F4** 现有 skill（无 skill.config）行为不变。

## review gates

- A→B：config 解析 build 通过再做存储。
- C→D：SDK 注入 build 通过再做 UI。
- D→E：UI build 通过再端到端验证。

## rollback points

- 阶段 E 失败（脚本拿不到 config）：检查 Worker 消息是否带 config、tsian.config 是否注入、readSkillConfig 是否读到值。
- 阶段 D 失败（UI 不显示配置）：检查 SkillRegistryEntry.configItems 是否有值、UI 组件是否读了 configItems。
- 阶段 A 失败（skill.config 不解析）：检查正则是否匹配 skill.config 路径、parseSkillConfig 逻辑。
