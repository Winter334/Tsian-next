# Implement: 默认 AIRP schema 与 hub-and-spoke Agent 阵容

## 执行清单

### PR1: Agent 阵容重构（workspace.ts 卡内容）

- [ ] 修改 `agents/master/agent.json`：contacts 改为 `["retrieval","post-processing"]`
- [ ] 重写 `agents/master/AGENT.md`：自己写正文，联系 retrieval 获取资料，联系 post-processing 落盘
- [ ] 重写 `agents/master/SOUL.md`：创作者身份，直接执笔
- [ ] 移除 `agents/narrative/` 全部文件（agent.json/AGENT.md/SOUL.md/notes.md）
- [ ] 移除 `agents/memory/` 全部文件（agent.json/AGENT.md/SOUL.md/notes.md）
- [ ] 新增 `agents/retrieval/agent.json`：contacts=["master"], platformTools=["workspace_read"], skills.enabled=["entity-reader"], level 1
- [ ] 新增 `agents/retrieval/AGENT.md`：智能检索工具定位，精炼回灌，语义搜索+锚点导航，用 read_entity（entity-reader Skill）读实体自动展开一层 _ref/_dir
- [ ] 新增 `agents/retrieval/SOUL.md`：检索专家，省 master 上下文，用 read_entity 读实体
- [ ] 新增 `agents/retrieval/notes.md`：空初始
- [ ] 新增 `agents/post-processing/agent.json`：contacts=["master"], platformTools=["workspace_read","workspace_write"], level 1
- [ ] 新增 `agents/post-processing/AGENT.md`：落盘+状态维护+记忆治理，cognitive folding
- [ ] 新增 `agents/post-processing/SOUL.md`：后处理工具，规范格式落盘
- [ ] 新增 `agents/post-processing/notes.md`：空初始
- [ ] 更新 `agents/studio-assistant/AGENT.md`：同步新阵容描述（移除 narrative/memory 提及，改为 retrieval/post-processing）
- [ ] 更新 `RUNTIME_DEFAULT_CARD_PATHS`：移除 narrative/memory notes 路径，加 retrieval/post-processing notes 路径
- [ ] 验证：`npm run build:web` 通过

### PR2: 默认 schema 落地（workspace.ts world/ 区）

- [ ] 重写 `world/README.md`：schema 范式说明（一实体一目录 + index.json 入口 + _ref/_dir 升级约定、默认实体类目 characters/locations、检索约定、前端约定、扩展指南含命名建议避免与 Agent Skill `skills/` 撞名）
- [ ] 新增 `world/characters/README.md`：角色实体格式说明 + 字段约定 + 渲染契约 vs 语义数据区分（渲染契约形式可以是字段/文件/目录/混合，关键是格式固定+位置固定，由创作者约定，通过 agent 定义/skill 约束 post-processing 遵守）+ _ref/_dir 升级示例（位置标记，与契约/语义分类无关）+ 前端约定（前端按创作者写死的路径直接读渲染契约，不做通用 _ref/_dir 解析）+ 范式说明
- [ ] 新增 `world/locations/README.md`：地点格式说明 + 示例
- [ ] 新增 `world/relationships.json`：空数组初始 `[]`
- [ ] 保留 `world/canon.md`：世界 canon（卡内容，非运行时）
- [ ] 更新 `world/rules.md`（若不存在则新增）：世界规则占位
- [ ] 不创建 `world/skills/` 目录（避免与 Agent Skill 撞名；功法/技能等类目作为可扩展示例写在 README 扩展指南里，不在默认卡实际创建）
- [ ] 注意：默认卡不预创建任何实际实体目录（如 characters/李四/）——只建类目 README，实际实体由游玩涌现、post-processing 创建
- [ ] 验证：`npm run build:web` 通过

### PR3: 存档运行时文件 + version bump

- [ ] `DEFAULT_WORKSPACE_VERSION` 从 6 改为 7
- [ ] 修改 `DEFAULT_SAVE_RUNTIME_FILES`：
  - 移除 `save/agents/narrative/notes.md`
  - 移除 `save/agents/memory/notes.md`
  - 新增 `save/agents/retrieval/notes.md`
  - 新增 `save/agents/post-processing/notes.md`
  - 新增 `save/world/relationships.json`（空数组）
  - 更新 `save/world/README.md`（运行时世界数据说明，指向 schema）
- [ ] 更新 `DEFAULT_SAVE_RUNTIME_UPGRADE_FILE_PATHS`：加入所有新文件路径
- [ ] 验证 upgrade 逻辑：旧存档（version<7）升级时补齐新文件
- [ ] 验证：`npm run build:web` 通过

### PR4: world-state-maintenance Skill + entity-reader Skill

#### 4a. world-state-maintenance Skill（post-processing 写入用）

- [ ] 新增 `skills/world-state-maintenance/SKILL.md`：post-processing 专用，负责实体状态写入 + 回合落盘
- [ ] 新增 `skills/world-state-maintenance/scripts/apply-world-state-plan.js`：browser_script，staged write
- [ ] inputSchema/outputSchema 参照 memory-maintenance
- [ ] allowed targets: `save/world/**/*.{json,md}` + save/history/turns/*.json。用通配而非穷举，一实体一目录模型下自动覆盖任意深度子文件
- [ ] 更新 `agents/post-processing/agent.json` 的 skills.enabled 加入 world-state-maintenance

#### 4b. entity-reader Skill（retrieval 读取用，只展开一层 _ref/_dir）

- [ ] 新增 `skills/entity-reader/SKILL.md`：retrieval 专用，自动展开一层引用的读取工具
  - 触发：agent 需要读取实体并自动展开 _ref/_dir 引用时
  - appliesTo: retrieval（也可供 master 直接读实体时用）
  - 声明 `read_entity` action，executor: browser_script
- [ ] 新增 `skills/entity-reader/scripts/read-entity.js`：browser_script，行为：
  - `tsian.workspace.read(path)` 读目标文件，解析 JSON
  - 遍历顶层字段：遇到 `{_ref: "file"}` → read 该文件内容内联替换；遇到 `{_dir: "dir/"}` → list + read 目录下所有 .json 文件，组装成对象内联替换
  - **只展开一层**：被展开内容内部的 _ref/_dir 标记保留不展开
  - 返回展开一层后的完整对象
  - 错误处理：引用文件不存在时保留标记 + 标注错误，不中断
- [ ] inputSchema: {path: string}；outputSchema: {path, data, expandedFields}
- [ ] 更新 `agents/retrieval/agent.json` 的 skills.enabled 加入 entity-reader
- [ ] 验证：`npm run build:web` 通过

### PR5: 方向文档更新

- [ ] 更新 `docs/active/agent-framework-runtime-workspace-direction.md` 第 4 节：
  - 替换「对等团队」为 hub-and-spoke 心智模型
  - master 为核、retrieval/post-processing 为工具型 agent
  - 调用频率不对称
- [ ] 更新第 5 节「工具原则」：
  - 保留「检索不垄断」原则
  - 澄清 retrieval 是省 context 封装而非垄断
- [ ] 更新第 9 节「推荐目录结构」：
  - agents/ 移除 narrative，新增 retrieval/post-processing
  - world/ 体现混合粒度实体组织
- [ ] 更新第 14 节「当前实现含义」：同步新阵容和新 schema
- [ ] 更新 `docs/active/current-state-handoff.md`：记录本次阵容+schema 变更
- [ ] 验证：文档无内部矛盾

### PR6: 验收测试

- [ ] 新建默认 save：确认产出新阵容（master+retrieval+post-processing）+ 新 schema 的 workspace 文件
- [ ] 旧存档升级：确认 version bump 后补齐新文件，不崩溃
- [ ] 浏览器 smoke：
  - 新建存档，workspace 浏览器看到新 agent 目录
  - world/ 下有 characters/skills/locations 目录 + relationships.json
  - 默认 AIRP 回合能跑通（master 能 agent_call retrieval 和 post-processing）
- [ ] `npm run build:web` 通过
- [ ] `npm run build:contracts` 通过（若 contracts 有变化）

## 验证命令

```bash
npm run build:contracts
npm run build:web
# 浏览器 smoke：新建存档 → 检查 workspace → 跑一轮 AIRP
```

## 回滚点

- PR1-PR3 是 workspace.ts 内容变更，纯数据，无代码逻辑风险。回滚 = git revert。
- PR4 Skill 变更若引入 bug，可回退 Skill 文件，不影响平台运行。
- PR5 文档变更是纯文档，无运行时风险。
- PR6 是验证，无回滚需求。

## 审查门

在 task.py start 前：
- [ ] prd.md / design.md / implement.md 三件套完整
- [ ] brainstorm 决策全部落地到 design.md
- [ ] 用户确认阵容方向（hub-and-spoke）和 schema 形状（混合粒度+语义检索）
- [ ] 前端双路径方案确认
