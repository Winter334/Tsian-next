# 助手前端自检工具 inspect_game_frontend

## Goal

为桌面助手 agent 提供一个 platform tool `inspect_game_frontend`，让助手能在隐藏 iframe 中加载某张游戏卡的 packaged 前端（复用与 `/play` 完全相同的真实加载路径），观测其渲染结果、报错、桥行为，并能驱动一回合、模拟玩家交互，形成"写前端 → 自检 → 改 → 复查"的创作闭环。这是 `docs/active/play-frontend-sdk-direction.md` 第 6 章助手职责第 9 条（看效果迭代）的物理实现，方向依据 `docs/active/assistant-frontend-inspection-direction.md`。

## User Value

- 助手 agent 当前盲写前端，写完看不到效果。自检补上反馈回路这一环，让助手能基于真实渲染诊断迭代。
- 官方侧顺带获得自动化回归测试设施（用真实 runtime 跑预设场景验证默认前端桥行为）。

## Confirmed Facts（已通过代码探明，无需重新论证）

- **加载逻辑可直接复用**：`resolvePackagedFrontendUrl({gameCardId, entry})`（`package-loader/packaged-frontend.ts:35`）返回 SW 虚拟 URL；`mountRemoteIframeFrontend(container, {url, bridge, sandbox, onBridgeReady})`（`bridge/remote-iframe-bridge.ts:262`）建 iframe+握手+事件转发，返回 dispose()。自检工具对专用隐藏容器复用这两步，1:1 镜像 PlayView 的 packaged 挂载。
- **sandbox 必须保留 `allow-same-origin`**：SW 同源客户端要求（PlayView:149 注释）；这也是父窗口能读 `contentDocument`/注入采集脚本的前提。
- **驱动回合走 `runAgentRuntimeTurn`**（`agent-runtime/index.ts:1879`）——纯函数，不读 active save、不写存档。**绝不走 `playFrontendBridge.interaction.sendMessage`**（硬绑 active save + 向玩家前端广播流式）。
- **ephemeral save 隔离**：`createLocalSaveFromGameCard(card)`（`saves.ts:93`）不设 active、不 emit savesChanged；`deleteLocalSave(save.id)`（`saves.ts:299`）清理 save/snapshot/history/workspace/checkpoints，不碰 active 指针。模型配置全局 localStorage，ephemeral save 自动继承玩家 provider/key/model。
- **工具注册走 special-tool 模式**（镜像 `agent_call`），需触 9 处文件（见 design.md）。
- **`MessageInteractionResult.snapshot` 恒存在**（`runtime.ts:474`，成功 resolve 必带），`turn-completed` 事件 payload 的 snapshot 总可用。
- **采集走父窗口侧观察**：packaged iframe 是 same-origin，可读 `contentDocument`、在 iframe context eval、劫持 `contentWindow.onerror`/`unhandledrejection`/`console`。

## Requirements

### R1 加载与采集（结构层 + 诊断层）
- 在 off-screen 隐藏容器中加载指定 gameCardId 的 packaged 前端，复用真实 SW 虚拟 URL + bridge 握手路径。
- 采集**结构层**：裁剪过的 DOM 树、关键元素 computed style、当前渲染的消息文本、bridge 状态。纯文本，任何 LLM 可读。
- 采集**诊断层**：JS 运行时错误（message+stack+source+行号）、console 日志、资源加载失败（SW fetch 404 / CDN import 404）、bridge 握手超时（hello 发了没 ready）。
- 采集走父窗口侧观察，**不要求前端配合**——白屏/不发 ready 的坏前端也能诊断。

### R2 操作面（驱动回合 + DOM 交互 + 刷新，可组合）
- 支持 `send: { message }`：用 ephemeral save + `runAgentRuntimeTurn` 跑 active 卡 master agent 一回合，采集完整事件时间线（turn-delta / turn-tool / turn-round-end / turn-completed，按顺序+时戳）。烧 token，显式参数。
- 支持 `actions: [{type:"click"|"type"|"press"|"scroll", selector, ...}]`：same-origin 下 `contentDocument.querySelector` + dispatchEvent 模拟玩家操作。
- 支持 `observeBetween: true`：每个 action 之间采一次结构层快照，看时序状态变化。
- 支持 `refresh: true`：操作后重新拉最新 snapshot（语义化包装 `runtime.getRuntimeSnapshot`，助手不用知道桥方法名）。
- 三者可组合：`send+actions` 覆盖完整玩家流；`actions+refresh` 看操作后状态；纯 `actions` 轻量交互；无 send/actions 纯加载观测。
- **不开放任意 bridgeCall**：send/refresh 是语义化原语，助手不用背桥协议，保住"SDK 即真相源"设计。
- 驱动回合在隔离的 ephemeral save 上跑，跑完即删，不污染玩家真实存档/列表 UI/active 指针。不走 `playFrontendBridge.interaction.sendMessage`（它 `:693` 硬绑 `ensureActiveSave()` + `:708` 用模块级 `previousTurnController` 会 abort 玩家在飞回合）。自检给隐藏 iframe 前端配专用 bridge，其 `interaction.sendMessage` 内部编排 ephemeral save 的 `runAgentRuntimeTurn` + 把流式事件通过 `mountRemoteIframeFrontend` 已有的事件转发推给该 iframe。

### R3 工具暴露
- 作为新 platform tool `inspect_frontend` 暴露给桌面助手 agent，走 special-tool 注册模式 + platform-tool 门控。工具名短（`inspect_frontend`）。
- 助手 `defaultAssistantConfig().platformTools.enabled` 声明此工具。
- **只检 active 卡**：工具不接受 cardId 参数，inspector 内部从 `getPlatformActiveGameCard()` 取当前卡。助手典型场景是"玩家在跟助手说改我的前端"，指的就是当前这张。
- 结果为结构化对象，大结果截断并标 `truncated`。

### R4 文件-行号映射
- stack 里的 `app.js:42` 能对回到源文件行（packaged 写文件时存行偏移，自检报错时换算）。助手定位改代码不用数行号。

### R5 复查 diff
- 第二次 inspect 能与第一次的结构层结果做 diff，"改没改好"一目了然。

## Acceptance Criteria

- [ ] 助手调用 `inspect_frontend()`（无 cardId 参数）能加载当前 active 卡的 packaged 前端，返回结构层 + 诊断层结果。
- [ ] 对白屏前端（不发 ready / JS 崩 / 资源 404），诊断层能给出具体原因而非"加载失败"。
- [ ] `inspect_frontend({send:{message:"..."}})` 能在 ephemeral save 上跑 master agent 一回合，返回事件时间线，回合后 ephemeral save 被删除、玩家真实存档/active 指针/列表 UI 不受影响。
- [ ] `inspect_frontend({actions:[...]})` 能执行 DOM 交互，`observeBetween` 能返回步间状态变化。
- [ ] `inspect_frontend({refresh:true})` 能操作后拉最新 snapshot。
- [ ] `send` + `actions` 可组合覆盖完整玩家流。
- [ ] 助手 `platformTools.enabled` 含 `inspect_frontend`，工具 schema 出现在 enabled tool 列表。
- [ ] 报错 stack 的行号能映射到源文件行。
- [ ] 第二次 inspect 结果含与第一次的 diff。
- [ ] inspect 与玩家 `/play` 游玩同一张卡并存不冲突；助手连续两次 inspect 时前一次隐藏 iframe 被 dispose，同一时刻只保留一个自检会话。
- [ ] vue-tsc 类型检查通过。
- [ ] 不破坏现有 PlayView packaged 加载、playFrontendBridge.sendMessage、save 列表 UI。

## Out of Scope（延后项，接口预留）

- **mock runtime**：`runtime:"mock"` 分支预留，初版只实现 `real`。等真实模式跑通、有真实时序当基准再补。
- **截图**：`screenshot` 选项预留，初版不做。same-origin html2canvas 可做但有 CSS 失真 + 需 vision 模型。当前由玩家手动截图代替。
- **通用浏览**：明确不做。
- **remote 前端自检**：cross-origin 读不到，不做。自检只服务 packaged 创作流。
- **深度性能分析**（layout thrash / long task）：不做。

## Open Questions

- ~~MVP 切片范围~~ → 已决：一次实现 R1-R6，单任务不拆父子。理由：R1-R6 共享同一 capability 函数 + 同一 iframe 会话 + 同一 ephemeral save 编排，拆开会反复改同一文件互相踩；项目无父子任务先例。不拆不等于不分阶段，implement.md 用有序 checklist 自然分阶段（加载采集骨架 → 驱动回合 → DOM 交互 → 行号映射 → 复查 diff），每阶段单独验证。
- ~~inspect 检哪张卡~~ → 已决：只检 active 卡，不接受 cardId 参数，inspector 内部从 `getPlatformActiveGameCard()` 取。
- ~~并发与生命周期~~ → 已决：inspect 与玩家 `/play` 游玩同一张卡并存（技术上无冲突，SW 虚拟 URL 纯函数式从 IDB 读 Blob，两个 iframe 各自加载同一卡前端互不干扰）。助手多次调 inspect 则单会话串行——后一次自动 dispose 前一次的隐藏 iframe，同一时刻只保留一个自检会话，避免资源泄漏。
