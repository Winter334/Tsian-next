# Tsian Assistant Frontend Inspection Direction

## 1. 文档目的

本文档记录助手 agent 自检游戏前端能力的方向与能力边界。

当前答案是：

`助手通过平台内置的自检设施在隐藏 iframe 中加载并观测 packaged 前端，能看渲染结果、能驱动回合、能模拟玩家交互、能查报错定位问题，形成"写→自检→改→复查"的创作闭环。`

本能力是 `docs/active/play-frontend-sdk-direction.md` 第 6 章"助手职责"第 9 条（看效果迭代）的物理实现，也是该方向第 4 章红线（`turn-completed.snapshot` 覆盖渲染）的自动验证手段。它不是独立小工具，是 play-frontend-sdk 方向的闭环依赖。

## 2. 核心定位

助手当前短板是反馈回路（盲写、写完看不到效果），不是脑力。自检补的就是这一环——让助手能观测自己写的前端在真实加载路径下渲染成什么样、桥行为对不对、有没有报错。

定位：

`packaged 前端的同源观测与操作设施，服务助手创作闭环与官方回归测试。`

两条必须守住的原则：

1. **复用真实加载路径**：自检用与 `/play` 完全相同的 Service Worker 虚拟 URL、同一 bridge、同一 sandbox 加载前端。不另起 headless 浏览器或第二份渲染环境——否则助手看到的和玩家看到的必然有差异，基于它迭代出来的结果在玩家那边可能不对。
2. **不要求前端配合**：自检要在坏掉的前端上工作。白屏的卡不发 ready、不发 render 信号，自检照样能拿到"加载到哪一步死的"。采集走父窗口侧观察（same-origin 下直接读 `iframe.contentDocument`、在 iframe context 里 eval 采集脚本），不靠前端自己上报。

## 3. 初版能力范围

### 3.1 能看：分层采集

| 层 | 内容 | 模型要求 |
|---|---|---|
| 结构层 | 裁剪过的 DOM 树、关键元素 computed style、当前渲染的消息文本、bridge 状态 | 任何 LLM（纯文本可读） |
| 诊断层 | JS 运行时错误（message+stack+source+行号）、console 日志、资源加载失败（SW fetch 404 / CDN import 404）、bridge 握手超时 | 任何 LLM |
| 视觉层 | 截图 | 初版不做 |

结构层是诊断主力。它能让"`--neon` 没生效"这种截图看不出来的问题一眼可见（computed style 显示 `--accent` 被误用），也让"消息列表空"被定位为"脚本崩在 line 42"还是"bridge 没 ready 导致渲染逻辑没触发"——这三种白屏助手的修法完全不同，结构层让它们可区分。

诊断层专为坏掉的前端设计，能把"白屏"拆成具体原因：

- JS 崩在 line 42 的 undefined 变量
- SW 没拿到 index.html
- CDN import 404
- bridge hello 发了没 ready

### 3.2 能操作

操作分两类，初版两类都做：

**驱动回合**：助手指令自检发一条测试消息，在 iframe context 里调 bridge 的 `interaction.sendMessage`，全程采集事件流。验证流式订阅、工具节点状态切换、回合边界、`turn-completed.snapshot` 覆盖渲染——这些桥行为只有跑一回合才显形。

**DOM 交互**：助手模拟玩家操作（click / type / press / scroll）。same-origin 下直接 `iframe.contentDocument.querySelector().click()` + dispatchEvent。配合 `observeBetween`（每个 action 之间采一次结构层快照），看"点 send 前 disabled、点 send 后变 enabled 又变 disabled"这种时序状态变化。可与驱动回合混编，覆盖完整玩家交互流。

### 3.3 结果结构

```
inspect(cardId, {
  runtime: "real",                 // 初版只实现 real，mock 预留接口
  drive: { message: "..." },       // 可选：驱动一回合
  actions: [...],                  // 可选：DOM 交互
  observeBetween: true,            // 步间采集
  wait: "turn-completed",          // 观测点
  ephemeral: true,                 // 真实模式必须，隔离 save
})
→ {
  structure: { dom, computedStyles, renderedText, bridgeState },
  diagnostics: { errors, console, resourceFailures },
  timeline: [...],                 // 事件时间线（驱动回合后）
  fileLineMap: {...},              // 行号映射
  diff: {...},                     // 与上次 inspect 对比（复查时）
}
```

## 4. 连带设计

### 4.1 真实 runtime + ephemeral save

初版自检直接用真实 runtime 跑回合。只跑一两轮，token 消耗 AIRP 玩家可接受。

安全红线：**自检必须跑在隔离的临时 save 实例上，跑完即弃，不污染玩家真实存档**。助手发起的 `sendMessage` 会真实跑一回合、消耗 token、写存档状态，platform-host 侧建 ephemeral save + ephemeral runtime engine，回合结束销毁。

### 4.2 事件时间线

驱动回合后，结果里要有一条按顺序记录所有 bridge 事件、带时戳的时间线。调试流式问题，时间线比截图有用十倍——"delta 顺序对不对、工具节点是不是在 delta 之前就触发了、snapshot 覆盖发生在哪一刻"全部可查。

### 4.3 文件-行号映射

诊断信息回给助手时带文件路径和行号映射。stack 里的 `app.js:42` 要能对回到 `default-frontend-files.ts` 里 `FRONTEND_APP_JS` 数组的第几行。packaged 前端写文件时存行偏移，自检报错时换算。助手改的时候不用在几百行字符串里数行号，让"查→定位→改"闭环快。

### 4.4 复查 diff

第二次 inspect 能和第一次的结构层结果做 diff——"上次 `--neon` 没生效，这次生效了；上次消息列表空，这次有 3 条"。"改没改好"一目了然，不用助手逐行对比两次完整诊断。

## 5. 闭环职责切分

工具负责**查和定位**，助手基于诊断信息自己**改**，工具不直接改代码。这条切分让工具简单、可靠、可复用——它不需要懂代码语义，只需要忠实地把 iframe 里的状态报出来。

```
自检(查+定位) → 助手读诊断 → 助手改前端文件 → 再自检(复查)
```

"能不能修对"取决于助手脑力（已具备）+ 诊断够不够定位（自检提供）。复查环节让"改没改好"立刻有反馈，这才是闭环。

## 6. 架构位置

不是 bridge 能力。bridge 是 iframe→平台方向；自检是反过来的、由助手经 runtime 发起的"平台→iframe 观察"。它是 **platform-host 的一个能力 + agent-runtime 的一个工具**。

和现有 `DebugBridge`（`getAiDebugRecords` / `onTurnDebugReady`）是同一类"开发期观测"设施，可考虑归到一起，但不塞进 play bridge（那是玩家前端用的，不是助手用的）。

## 7. 边界（初版做不到）

1. **视觉主观判断**：结构层能说"`--neon` 没生效"，但"这配色好不好看"需要 vision 模型，初版不押这条。
2. **跨设备渲染差异**：自检在平台当前浏览器跑，和玩家看到的一致，但不同设备/浏览器差异覆盖不到。
3. **深度性能分析**：能采到加载/渲染时长，但 layout thrash、long task 这类要更专业采集，初版不追求。
4. **remote 前端**：cross-origin 读不到 contentDocument、注入不了脚本、截不到图。remote 是官方/可信前端，助手不创作 remote，这个限制可接受——自检只服务 packaged 创作流。
5. **Canvas / WebGL 内容**：截图方案（延后）截不了 canvas 内绘制内容，AIRP 前端基本不涉及，可标为不支持。

## 8. 延后项（初版不做，接口预留）

- **mock runtime**：`inspect` 的 `runtime: "mock"` 分支预留，初版只实现 `real`。mock 的价值是省 token、快、可重复、构造特定场景，但 AIRP 只跑一两轮消耗可接受，这些价值初版非必需。且 mock 要忠实复刻真实 runtime 的事件时序（`turn-delta` 与 `turn-tool` 顺序、`turn-round-end` 的 kind 取值、turn/round 编号、snapshot 字段），做不忠实的 mock 比没有更糟——前端在 mock 上测通过、真实跑挂。等真实模式跑通、有了真实时序当基准，第二阶段再补 mock 照着复刻。
- **截图**：same-origin 下用 html2canvas 可做，但有三条限制——是 dom 重绘非原生渲染（`backdrop-filter`、`mix-blend-mode`、某些 webfont 会失真）、依赖 vision 模型才兑现价值、canvas 内容截不了。初版不做，当前由玩家手动加载前端截图代替。接口位置（`screenshot: true`）预留。
- **通用浏览**：助手访问任意 URL 参考站、文档、示例。明确不做——价值低频、上 headless 浏览器是独立运维负担、与 Tsian 核心（AIRP runtime）无关。需要参考站时由玩家手动截图发给助手。

## 9. 附属价值

test-mode runtime（延后项）顺带给了官方一个**自动化回归测试设施**——默认前端每次改动都能用预设剧本跑一遍验证桥行为，不用人肉。这是"一鱼两吃"：mock 剧本既服务助手自检，也服务官方回归。第二阶段补 mock 时一并兑现。

## 10. 落地路径

1. **初版自检**：platform-host 隐藏 iframe + 真实加载路径 + 结构层/诊断层采集 + 驱动回合（真实 runtime + ephemeral save）+ DOM 交互 + 事件时间线 + 文件行号映射 + 复查 diff。agent-runtime 暴露 `inspect_game_frontend` 工具给助手。
2. **第二阶段**：补 mock runtime（接口已预留）+ 截图（接口已预留）。
3. **明确不做**：通用浏览、深度性能分析。

第 1 步是 play-frontend-sdk 方向闭环的依赖项，可与 SDK 抽包并行推进，但创作闭环要真正成立，自检初版必须先跑通。

## 11. 检查清单

规划自检相关新任务时，先问：

1. 观测是否走与 `/play` 完全相同的加载路径（SW 虚拟 URL、同一 bridge、同一 sandbox）？若另起渲染环境，回到原则 1。
2. 自检是否能在不发 ready 的坏前端上工作？若依赖前端配合上报，回到原则 2。
3. 工具是否在替助手改代码？若是，退出修改、只保留观测报告。
4. 真实模式是否跑在 ephemeral 隔离 save 上？若碰玩家真实存档，回到 §4.1 红线。
5. 是否在初版塞延后项（mock、截图、通用浏览）？若是，回到 §8。
6. 采集结果是否纯文本可读（结构层/诊断层），而非强依赖 vision？初版主力是结构层。

若答案显示实现正在偏离初版范围或违背两条原则，应回到本文档重新切分边界。
