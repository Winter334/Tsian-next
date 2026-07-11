# 可见 Play iframe 前端自检

## Goal

将 `inspect_frontend` 从“创建隐藏 iframe + 临时存档复现”改为直接检查和操作玩家当前 `/play` 窗口中已经挂载的真实前端，使桌面助手能够接管玩家正在看到的现场、通过真实 UI 路径复现问题、修改前端并验证结果，不再要求玩家描述后由助手在隔离环境中重建场景。

## Background

- 当前 `inspect_frontend` 自行挂载隐藏 iframe，并使用 ephemeral save 与专用 inspection bridge，无法看到玩家当前界面的真实状态。
- `/play` 中的 packaged frontend 已由平台以 same-origin sandbox iframe 挂载，父页面能够读取 DOM、采集样式并派发交互事件。
- 真实玩家回合成功完成后会自动创建规范检查点；恢复到调试前检查点会覆盖 save-runtime 状态文件、裁剪之后的 turn/trace，并删除未来检查点。
- `frontend/src/**` 和构建产物属于游戏卡前端文件，不进入 save-runtime 检查点；恢复运行时检查点不会撤销助手完成的前端修复。
- 使用场景假设调试期间 `/play` 由助手独占操作，玩家不会并发游玩。

## Requirements

### R1. 可见 Play iframe 是唯一目标

- `inspect_frontend` 只能操作当前 `/play` 窗口中已经挂载的真实 packaged frontend iframe。
- “可用”指 Play 窗口已经进入 playing 状态并保有 iframe；被其他窗口遮挡或最小化不影响检查。
- 工具不主动打开 `/play`、选择存档或越过启动器。窗口关闭、仍在启动器、前端正在成功构建后的重挂过程中，均应 fail loud 并提示玩家准备好真实现场后重试。
- 构建失败且旧 iframe 仍挂载时，继续允许检查旧前端；构建错误由既有 `frontend-build-status` 等渠道呈现。
- 第一版只支持 same-origin packaged frontend。跨域 remote frontend 明确不支持，不提供 bridge-only 降级行为。
- 不再创建隐藏容器或第二个 iframe；不保留 hidden/live target、兼容回退或旧路径开关。

### R2. 通过真实 UI 与真实 bridge 复现

- 助手可以读取当前 iframe 的 DOM/ARIA 结构、可见文本、计算样式、bridge 状态和调试诊断。
- 助手可以执行 click、fill/type、press、scroll、selectOption、check、hover、focus，并可采集动作间快照。
- 助手通过填写输入框、点击发送按钮等真实 UI 操作触发回合，测试必须覆盖前端自己的事件处理和现有 `playFrontendBridge`，inspector 不得旁路调用 `sendMessage`。
- `operation` 取 `"inspect" | "finish"`，省略时为 `"inspect"`。`finish` 与 actions、wait、timeoutMs、observeBetween、autoWait 互斥。
- 删除旧 `send`、`refresh`、`runtime`、`screenshot` 输入，以及所有依赖 ephemeral turn 的行为。

### R3. 泛用 runtime-settled 等待

- `wait` 只保留 `"runtime-settled"`，表示等待本次真实 UI 运行链稳定，不沿用旧 `bridge-ready` / `turn-completed` 语义。
- 带 actions 的等待必须在本次 actions 后观察到至少一个真实 `interaction.sendMessage`；未触发时快速返回 `INSPECT_RUNTIME_NOT_TRIGGERED`，不得等待完整超时。
- 上一次调用立即返回或等待超时后，如果同一 iframe 仍有已观察到的 active/unfinished send chain，后续 inspect 可以不带 actions 继续等待。没有 active chain 时快速返回 `INSPECT_RUNTIME_NOT_ACTIVE`。
- 从 send 开始，跟踪该可见 iframe 发出的全部 bridge RPC，不解释 Agent、purpose、entrypoint、maintenance 或特定卡业务逻辑。所有请求都进入 in-flight，包括可能等待用户回答的请求。
- 多个 send 和随后产生的所有 RPC 都归入同一活动窗口；in-flight 清零并连续 2 秒无新 RPC 后才视为 settled。
- `timeoutMs` 可配置，默认 300000ms，并应有合理上限。超时只停止 inspector 等待，不中止真实 bridge 请求或运行时；调试会话继续有效。
- RPC failed、主回合失败或后处理失败时仍返回最终 DOM/诊断快照，并在通用 activity/runtime 状态中标记失败；前置参数、目标和 baseline 错误仍使工具失败。
- 通用 `activity` 替换旧 turn timeline。activity 只记录 sequence、requestId、method、started/completed/failed、相对时间与错误 code/message，不记录 params、result、剧情正文或 workspace 内容。

### R4. 自动建立并持久化调试 baseline

- 第一次 `operation:"inspect"` 调用即开始调试会话，即使本次没有 actions。
- 建立会话前要求当前 Play handle ready、active save/card 与 Play 一致、bridge/runtime 已静默、前端不处于重建/重挂阶段。
- baseline 严格选择当前 save 最大 turn 上的规范检查点：
  - turn > 0：同 turn 最新 `post-turn-maintenance` 优先，否则最新 `after-turn`；
  - turn = 0：同 turn 最新 `manual` 优先，否则 `initial`；
  - 没有同 currentTurn 检查点时拒绝开始，不回退到更早 turn。
- 锁定检查点的精确 ID；后续不得通过时间、turn 或 label 重新猜测。
- baseline `{ saveId, gameCardId, checkpointId, baselineTurn, startedAt }` 作为平台本地内部状态持久化，页面刷新、助手异常退出、切换助手对话、关闭 Play 或返回启动器均不自动回滚或丢失。
- 调试会话全局绑定当前 `/play` + active save，不绑定某个助手对话；同一时刻只有一个 baseline。
- 每次结果公开完整 debugSession 状态，至少包含 saveId、baselineCheckpointId、baselineTurn、startedAt 和 `rollbackScope:"save-runtime"`。
- 第一版不主动创建新检查点，也不向助手暴露通用创建检查点能力。

### R5. baseline 生命周期保护

- 调试会话存续期间，baseline 的精确 checkpoint ID 必须免于普通检查点裁剪、同 turn maintenance 替换和 turn-0 initial 替换。
- 调试期间真实前端若请求恢复到 baselineTurn 之前，平台必须拒绝，防止裁掉 baseline 恢复所需的 turn 日志。恢复到 baseline 或测试期检查点允许，且不会自动结束调试会话。
- active save 与 marker.saveId 不一致时，inspect 和 finish 都拒绝并提示先切回原 save；不得后台恢复不可见旧存档。
- Play 关闭或回到启动器时保留 marker；玩家重新打开原 save 并挂载 packaged frontend 后可继续或 finish。
- baseline save/checkpoint 已删除或 marker 损坏时，返回一次明确的不可恢复错误并清除失效 marker，解除全局阻塞；不得猜测替代检查点。

### R6. 显式 finish 回滚

- 无活跃调试会话时 `operation:"finish"` 返回明确 `DEBUG_SESSION_NOT_ACTIVE`，不伪装成成功。
- finish 要求 active save 为原 save、原 save 的 packaged Play iframe 已挂载且 ready、当前 bridge activity 已 settled。仍有请求或未过静默窗口时返回 `DEBUG_SESSION_BUSY`，不恢复、不清 marker。
- finish 恢复精确 baseline，使测试期 save-runtime、turn/trace 和未来检查点自然丢弃；“未来检查点”既包括 turn 大于 baselineTurn 的记录，也包括同一 turn 上在 baseline 之后创建的记录。卡级数据、`frontend/src/**` 及构建产物保留。
- restore 成功后立即清持久化 marker，再通知 debug 订阅方并触发 Play iframe 重挂。不得因后续 reload 失败重新留下 marker 或重复恢复。
- finish 固定等待新 iframe ready 最多 10 秒：
  - ready 成功时返回 restoredTurn 与一次性恢复后结构/诊断快照；采集后立即清理，不开启新 baseline；
  - reload/ready 失败时返回 `restored:true, reloadReady:false` 的部分成功结果，明确运行时已经恢复且 marker 已清。

### R7. iframe 与诊断生命周期

- Play mount 必须向平台提供显式的当前 iframe handle；inspector 不通过桌面 DOM selector 猜目标，也不持久化 bridge sessionId。
- 前端源码成功重建会替换 iframe；后续调用必须取得最新 generation，不能继续操作 disconnected 节点。
- inspector 只借用 PlayView 持有的 iframe，任何 cleanup 都不得 dispose 或移除它。
- 调试会话在同一 iframe generation 内持续采集 console/error/resource 和 bridge activity；每次 inspect 返回该 generation 自接管以来的累计诊断（保留有界截断）。
- iframe generation 改变时，清理旧 collector/wrapper/listener，诊断、activity 和 diff 基线按新 generation 重置，不把修复前错误混入修复后判断。
- 已加载 iframe 只保证接管后的错误/console 及当前 performance/DOM 状态，不宣称恢复接管前历史。
- 合成 MouseEvent/Event/KeyboardEvent 与 realm 类型判断必须使用 iframe 自身 window 或跨 realm 安全的 tag/duck typing。

### R8. 完全替换 AI-facing 旧模型

- 删除 hidden container、ephemeral save、专用 inspection bridge、临时 runtime turn、手工 `turn-completed` 及相关旧状态/时间线代码。
- 更新工具类型、参数 normalize、native schema、text-mode 说明、权限描述、桌面助手默认说明和当前产品文档，使助手只学习“操作当前真实 Play iframe”的模型。
- AI-facing 内容不保留 hidden iframe、ephemeral save、旧 inspector `send`/`refresh`、mock runtime、旧 wait 值或隔离复现示例。
- 不添加迁移或旧参数兼容层；旧调用应在参数边界明确失败，而不是静默降级。

## Acceptance Criteria

- [ ] AC1: 已挂载 packaged Play（包括被遮挡/最小化）可被 inspect；没有 Play、启动器态、remote、building/reloading 分别返回清晰错误，且 DOM 中始终只有 Play 自己的 iframe。
- [ ] AC2: 首次纯读取 inspect 也锁定并持久化严格 currentTurn baseline；后续调用和页面刷新沿用同一精确 ID，并返回完整 debugSession。
- [ ] AC3: baseline 在大量测试回合、普通 prune、同 turn maintenance 替换和 turn-0 initial 替换下仍存在；调试期恢复到 baseline 之前被拒绝。
- [ ] AC4: actions 操作玩家当前真实 iframe；fill + click 走真实发送路径，inspector 不直接调用 bridge。
- [ ] AC5: `runtime-settled` 未触发 send、无 active chain、续等、多个 send、RPC failed、长请求和 timeout 场景均符合 R3；2 秒静默规则不含卡/Agent/maintenance 特判。
- [ ] AC6: activity 是无 params/result 的通用 bridge 元数据，失败现场仍同时返回结构、诊断和 runtime 状态；旧 turn timeline 不存在。
- [ ] AC7: 同 generation 多次检查不会叠加 wrapper/listener，诊断累计；成功重建后 generation、诊断、activity 和 diff 正确重置，构建失败仍可检查旧 iframe。
- [ ] AC8: marker 跨助手会话、页面刷新和 Play 关闭/重开仍有效；active save 切换时阻塞，切回后可继续。失效 marker 一次报错后清理。
- [ ] AC9: finish 无会话、busy、save 不匹配、target 未挂载分别 fail loud；成功 finish 恢复 baseline、清除测试 turn/trace/未来 checkpoint，保留 `frontend/src/**` 修复。
- [ ] AC10: finish 恢复后重挂成功返回一次性恢复快照；重挂超时返回部分成功且 marker 已清；重复 finish 返回无活跃会话。
- [ ] AC11: 源码、schema、prompt、权限说明和当前文档中没有旧隐藏/ephemeral/专用 send/refresh 行为残留。
- [ ] AC12: `npm run build:web` 通过；若实际修改共享 contracts，则 `npm run build:contracts` 也通过。

## Out of Scope

- 跨域 remote frontend DOM 检查或 bridge-only 降级。
- 工具主动打开 `/play`、选择存档或驱动启动器。
- 回滚 iframe origin 的 localStorage、sessionStorage、独立 IndexedDB、网络请求或其它浏览器外部副作用。
- 回滚卡级内容或前端源码；第一版只保证 save-runtime 回滚。
- 给助手提供通用任意时点检查点创建工具。
- 玩家与助手同时操作 `/play` 的并发协作。
- 对 2 秒静默窗口之后才由长定时器发起的异步工作提供 settled 保证。
