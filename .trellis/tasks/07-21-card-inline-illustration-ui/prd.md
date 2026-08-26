# 正文内嵌插图交互

## Goal

在沉浸阅读器正文原位置展示 storyteller 的插图简报。玩家点击卡片后独立生成图片，故事继续推进不受阻；生成成功后，图片能够在 reload、history window remount 和 checkpoint restore 后由持久化 workspace 恢复。

本任务负责 assistant view model、settled marker parser、卡片状态、Agent invocation、stable path probe、Object URL、lightbox、双源同步和现有打包流程。它不实现 Provider、Agent Prompt、Host source binding 或 checkpoint commit。

## Requirements

### R1. Preserve authoritative assistant metadata

- 先把 live completion、history load 与 opening turn 0 统一为包含 `{turn, content, displayContent, projections}` 的 settled assistant view model。
- `turn` 必须来自平台持久化/完成结果，不能用数组位置、当前 turn 或渲染序号推算。
- `content` 保留 clean prose；`displayContent` 只作为布局源，缺失时 fallback 到 `content`；`projections` 原样保留通用结构。
- streaming draft 与 settled assistant 分离。只有 settled 数据可以产生可交互插图 target。
- 修复开发前端与实际卡前端的等价数据流；opening 注入、history windowing 和新回合完成不能再次丢失 metadata。

### R2. Ordered, fail-soft illustration parser

- settled parser 扫描 `displayContent ?? content` 中的完整 `[[插图]]...[[/插图]]`，输出按正文顺序交错的 prose/illustration segments。
- 第 N 个完整 marker 只对应 `projections.illustrations[N]`。只有 marker capture trim 后与该 projection raw string 相等且 shared validator 返回 valid，才可形成 target。
- target 固定为 `{kind:"turn-projection",turn,projectionKey:"illustrations",index:N}`。
- 前三个 valid brief 可交互；第 4 个及之后 valid brief 只显示描述，不产生 invoke。invalid marker 不占三个 valid 名额。
- parse error、non-object、extra field、type/length/ref invalid 均 fail-soft：只显示经过边界限制的 string `title` / `description` fallback，或省略整个 marker；不 coerce、不 stringify、不展示 refs。
- 所有 marker 内容在进入 Markdown 前被结构化分离。未闭合/孤立 marker 在 settled 与 streaming 中都隐藏，不能闪现原始 JSON。
- streaming 只渲染安全 prose：看到 opener 后暂存 marker suffix，直到完成或 settled；不在 delta 阶段生成卡片或触发 path probe。

### R3. Capability discovery

- frontend ready/init 时调用现有 `tsian.card.entrypoints()` 并缓存 `imageGeneration`。
- 只有 `{agentId,protocol:"tsian.image-director.v1"}` 完整有效时，otherwise-valid brief 才可交互。
- 缺失、畸形或未知 protocol 从首帧起降级为不可交互描述；不得在首次点击时才发现 capability 不存在。
- invoke 使用 cached `agentId`，禁止硬编码 `image-director`。

### R4. Target-only invocation

- 激活卡片时，Agent input 只含 closed `{brief, prose}`；prose 使用同一 settled assistant 的 clean `content`。
- 只在 invoke options 发送：

  ```ts
  {
    generatedMediaTarget: {
      kind: "turn-projection",
      turn,
      projectionKey: "illustrations",
      index
    }
  }
  ```

- 不发送任何 caller-computed durable identity、source revision、branch epoch、path、Provider/model 或场景/实体快照。
- invocation Promise 只有在 Host durable commit 成功后才视为完成。UI 验证 closed Agent result，但不把 result path 当成资产 authority；随后用 shared helper 派生 stable path 并 `workspace.read`。
- target missing/stale、Agent、Tool、Provider、read 或 decode 失败只影响当前卡，不影响 Composer、正式回合或其它卡。

### R5. Independent card state

- 状态以 `{turn,projectionKey,index}` 为 key，至少包含 `idle`、`generating`、`ready`、`regenerating`、`error`。
- 同一卡在 in-flight 时阻止重复激活；不同卡可并发生成，不增加全局串行队列。
- initial generation 显示轻量进度并保留 brief；失败恢复可重试卡片。
- ready 显示最新图片。regeneration 保留旧图和 URL；成功读取/解码新 Blob 后原子替换，失败继续保留旧图。
- 生成不进入 formal turn pending/Composer disabled 状态，不写 history UI state，也不阻止下一回合。

### R6. Durable recovery and stale async

- stable path 由 shared helper 从 target 派生：`save/assets/generated/turn-projection/<turn>/<projectionKey>/<index>`。
- settled 卡在 mount、history remount、reload、invocation completion 和 restore rebuild 后 probe 该 path；存在合法 raster Blob 即进入 ready，否则保持 idle/fallback。
- restore 开始时使当前 probe/invocation completion token 失效、关闭相关 lightbox 并 revoke URLs；restore 完成或失败后按平台当前 workspace 重建 settled view 和 path probe。
- 每个异步 read/decode/invoke completion 在写状态前比较 target key、attempt token 和 view lifecycle epoch，防止旧结果覆盖新分支 UI。
- Object URL 在 replacement、target disappearance、window unmount、restore 和 app unmount 时 revoke；同一 Blob 不无限重复创建 URL。

### R7. Interaction and accessibility

- idle valid brief 是正文内的紧凑描述块，展示 title/description；整卡支持 pointer、Enter、Space 激活，并有明确 `aria-label` 和 focus ring。
- 点击即发起生成，不增加确认 modal；in-flight 使用 `aria-busy` 并阻止重复输入。
- ready 图片 alt 使用 description。点击图片打开专用 lightbox；独立的低调 regenerate icon button 带 tooltip/accessibility name。
- lightbox 支持 dialog semantics、初始焦点、Tab/Shift+Tab containment、Escape、backdrop/close button、trigger focus return、scroll lock cleanup。
- 适配 360px mobile、窄横屏、desktop、safe area、200% zoom 与 `prefers-reduced-motion`；控件不依赖 hover 才可发现。

### R8. Source and package delivery

- `apps/play-frontend-dev/src` 与 `cards/沉浸阅读器.tsian-card/frontend/src` 的 task-owned 文件保持等价；保留现有有意差异，不整树覆盖。
- 构建开发前端后，使用现有 `npm run package:card` / `npm run repack:immersive-reader` 重建实际卡 dist 与 inventory。
- 本任务不修改打包基础设施、不创建 package harness，也不恢复已删除的通用运行时机制或文件级测试。
- 与协议子任务共享最终一次 card version bump 和全量 manifest 校验。

## Acceptance Criteria

- [ ] AC1: turn 0、live settled 和 history reload 都保留正确 `{turn,content,displayContent,projections}`。
- [ ] AC2: 1/2/3/4+ marker 保持原位和顺序；只有前三个 valid brief 可交互，target index 与 persisted projection 精确一致。
- [ ] AC3: malformed、schema-invalid、missing projection、capture mismatch、未闭合 marker 和跨-delta marker 均不泄漏 JSON 或阻断正文。
- [ ] AC4: exact-v1 entrypoint 可用；missing/malformed/unknown entrypoint 首帧 fail-soft 且零 invoke。
- [ ] AC5: invocation request 只含 brief/prose，options 只含 generated-media target；UI 不计算或回显持久化 authority。
- [ ] AC6: 同一卡去重、不同卡并发、生成期间推进故事均通过；失败隔离到单卡。
- [ ] AC7: reload/remount/restore 通过 stable path 恢复正确图片；restore race 的旧 completion 不污染新 UI。
- [ ] AC8: regeneration 成功原子替换，失败保留旧图；Object URL 生命周期无泄漏。
- [ ] AC9: pointer/keyboard/touch/lightbox/reduced-motion/mobile/zoom 行为可用。
- [ ] AC10: 两棵 source、实际 card dist 和 manifest 经现有 package/repack 工作流一致。

## Out of Scope

- 自动生成、批量生成、全局队列/配额、取消、进度百分比、图库与版本历史。
- Provider/Tool 配置 UI、图片参数面板、mask/crop/editor、角色头像管理。
- Agent Prompt、图像 adapter、Host CAS、checkpoint patch、restore storage 与 Blob GC 实现。
- 打包 tooling 新建、旧配置迁移与 generic invokeAgent persistence 机制。
