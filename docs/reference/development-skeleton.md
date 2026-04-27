# AIRP Development Skeleton

## 1. 文档目的

本文档用于确定项目进入正式开发阶段后的 `仓库骨架与模块边界`。

当前阶段只回答以下问题：

- 仓库顶层应如何组织
- 官方后端、平台 WebUI、本地运行时、游玩前端包各自放在哪里
- 哪些内容应做成共享包，哪些内容不应过度拆分

当前阶段明确不讨论：

- 具体文件命名细节
- 具体 API 字段
- 具体数据库表结构
- 具体构建配置

## 2. 当前骨架原则

正式开发阶段，当前建议固定以下原则：

- 采用 `单仓库`
- 以 `部署边界` 划分应用
- 只把 `跨应用稳定共享` 的部分抽成共享包
- 玩家运行时仍然默认在 `平台 WebUI` 内部
- 不为了未来可能的扩展提前拆成大量 package

可以压缩为一句话：

`按部署边界分应用，按稳定共享边界分少量包，其余逻辑尽量留在所属应用内部。`

## 3. 推荐仓库骨架

当前推荐的顶层结构如下：

```text
Tsian/
  docs/
  experiments/
  apps/
    platform-server/
    platform-web/
  packages/
    contracts/
    runtime-core/
  builtin/
    play-frontends/
      official-default/
    mods/
```

这套结构的核心含义是：

- `apps` 放真正可部署的应用
- `packages` 只放少量稳定共享能力
- `builtin` 放官方自带内容，与未来用户内容处于同一物种

## 4. Apps 层

### 4.1 apps/platform-server

这是官方后端。

它负责：

- 平台接口
- 工坊
- 模组分发
- 游玩前端包分发
- 平台级元信息管理

它不负责：

- 玩家核心运行时
- 玩家存档执行
- 玩家本地记忆系统主链

### 4.2 apps/platform-web

这是平台 WebUI，也是玩家本地运行时壳层。

它负责：

- 平台管理界面
- 本地运行时宿主
- 本地数据存储管理
- 游玩前端包装载
- 游玩前端桥接

当前建议将它内部继续按职责收敛为几块：

- `ui`
- `runtime-host`
- `storage`
- `package-loader`
- `bridge`

这里的含义是：

- `ui` 负责平台设置、工坊、模组管理等页面
- `runtime-host` 负责 AI 调度、上下文组装、记忆主链等本地运行时
- `storage` 负责 IndexedDB + Dexie
- `package-loader` 负责装载模组和游玩前端包
- `bridge` 负责给游玩前端包暴露受控能力

## 5. Packages 层

### 5.1 packages/contracts

这个包只放 `跨应用稳定契约`。

当前建议放在这里的内容包括：

- 模组清单契约
- 游玩前端包清单契约
- 平台与游玩前端包之间的桥接契约
- 需要被 server 与 web 同时理解的少量共享类型

这里不应放：

- 具体业务实现
- 平台 UI 逻辑
- 本地数据库访问逻辑

### 5.2 packages/runtime-core

这个包只放 `与运行环境弱耦合` 的核心运行逻辑。

当前建议放在这里的内容包括：

- AI 主链编排骨架
- 记忆检索主流程
- 事件沉淀主流程
- 运行时状态更新主流程

这里不应放：

- Dexie 访问代码
- 平台页面逻辑
- 具体浏览器 API 调用

它的目标不是做成庞大框架，而是：

- 让平台 WebUI 的本地运行时有一层更稳定的核心逻辑承载
- 为未来可能的其他运行宿主预留复用空间

## 6. Builtin 层

### 6.1 builtin/play-frontends

这里放官方自带的游玩前端包。

当前建议至少有：

- `official-default`

它和未来玩家上传的游玩前端包在系统定位上是一致的，只是分发来源不同。

### 6.2 builtin/mods

这里放官方自带模组。

如果一开始没有，也可以先空着。

这样设计的意义是：

- 官方内容和用户内容共享同一类内容模型
- 平台不需要为“官方内容”做完全不同的一套装载逻辑

## 7. 当前不建议拆成独立包的部分

为了避免过度设计，以下内容当前不建议单独拆成 package：

- Dexie 存储层
- 平台设置页面逻辑
- 工坊页面逻辑
- 模组下载与启用逻辑
- 游玩前端包加载实现

这些内容当前更适合留在 `apps/platform-web` 内部。

原因如下：

- 它们目前主要服务单一应用
- 抽出去不会显著提高复用，反而会增加来回跳转和边界复杂度

## 8. 核心边界约束

当前建议固定以下边界：

- `platform-server` 不直接承载玩家运行时
- `platform-web` 持有玩家本地运行时与本地数据库
- `游玩前端包` 不直接接触 Dexie 实例
- `游玩前端包` 只通过桥接契约访问被允许的数据与能力
- `contracts` 只定义契约，不写业务实现
- `runtime-core` 只承载核心流程，不碰具体宿主 API

## 9. 第一阶段最小开发顺序

当前建议的正式开发顺序如下：

1. `apps/platform-server`
2. `packages/contracts`
3. `packages/runtime-core`
4. `apps/platform-web`
5. `builtin/play-frontends/official-default`

原因如下：

- 先把平台与分发后端立住
- 再把共享契约立住
- 再把本地运行时核心立住
- 然后接平台 WebUI 与本地存储
- 最后再接官方游玩前端包

## 10. 当前推荐口径

截至目前，正式开发骨架的推荐口径可以压缩为：

`仓库采用单仓库结构；apps 按部署边界分为 platform-server 与 platform-web；packages 只保留 contracts 和 runtime-core 两个稳定共享层；官方游玩前端包与官方模组放在 builtin 中，与未来用户内容保持同一内容模型；平台 WebUI 内部继续承载本地运行时、Dexie 存储、桥接与包加载。`


