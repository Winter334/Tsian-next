# Tsian Documentation Guide

## 1. 当前维护口径

`docs/` 里曾经沉淀了大量正式开发前的设计骨架。当前项目已经进入可运行原型阶段，因此后续不再要求所有历史骨架文档同步维护。

当前文档维护原则如下：

- 以当前代码状态为准。
- 以活跃入口文档为准。
- 历史 `*-skeleton.md` 文档只作为设计背景参考。
- 新增实现决策时，优先更新活跃入口文档，不要继续分散追加到大量旧骨架文档。
- 如果活跃入口文档和历史骨架文档冲突，优先相信活跃入口文档与当前代码。

## 2. 活跃入口文档

当前只建议把以下文档作为日常维护入口。

### 2.1 当前状态

- `active/current-state-handoff.md`

用途：

- 新会话接手
- 查看当前已经实现什么
- 查看当前还没有做什么
- 查看关键代码入口

### 2.2 下一阶段计划

- `active/implementation-plan.md`

用途：

- 查看下一阶段做什么
- 查看验收顺序
- 避免过度设计和提前优化

### 2.3 主干设计

以下文档记录轻易不会改变的主干决策：

- `active/memory-system-decisions.md`
- `active/narrative-entity-archive-skeleton.md`
- `active/patch-contract-skeleton.md`

用途：

- 记忆系统为什么以事件为主
- 档案为什么是实体当前状态唯一真源
- patch 为什么使用 `currentTime / globals / events / archives`
- 为什么当前不引入 `del`、RFC 6902 JSON Patch、多事件复杂定位

## 3. 历史参考文档

以下文档主要是设计期讨论产物，后续默认不要求持续维护：

- `reference/ai-runtime-skeleton.md`
- `reference/development-skeleton.md`
- `reference/local-runtime-skeleton.md`
- `reference/local-storage-skeleton.md`
- `reference/mod-and-save-skeleton.md`
- `reference/prompt-preset-skeleton.md`
- `reference/system-architecture-skeleton.md`
- `reference/technical-stack-skeleton.md`
- `reference/webui-runtime-skeleton.md`

它们的价值是保留早期设计背景，不是描述当前实现状态。

如果后续需要重新讨论某个方向，应把结论收敛回活跃入口文档，而不是继续维护所有历史骨架文档。

## 4. 当前稳定主干

当前项目的稳定主干可以压缩为：

`Tsian 是一个 AIRP 专精框架；平台 WebUI 承载本地运行时；游玩前端包只负责交互与渲染；记忆以事件为主，档案作为实体当前状态唯一真源，globals 承载非实体全局状态；档案存储保持扁平对象，内部类型定义可用父类 / 子类复用字段，但 AI 只看最终 type 与合法字段；维护 AI 通过 currentTime / globals / events / archives patch 修改运行时。`

当前主链为：

1. 玩家通过前端包发送输入。
2. 平台 WebUI 调用检索 AI 生成实体查询组。
3. 平台 WebUI 根据事件、档案和向量重排组装记忆补充。
4. 正文 AI 生成本轮剧情正文。
5. 维护 AI 读取本轮剧情并输出 patch。
6. 平台 WebUI 应用 patch 到时间、globals、事件和档案。
7. 前端包重新读取快照、事件、档案和调试信息进行渲染。

## 5. 文档清理建议

当前已经把历史文档移动到 `reference/`，避免与活跃入口混在一起。

后续如果需要删除某份历史文档，必须先确认它的信息已经被 `active/` 下的主干文档吸收。
