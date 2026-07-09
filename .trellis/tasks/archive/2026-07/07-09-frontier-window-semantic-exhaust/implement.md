# 实现计划：frontier 推进窗口语义化与读完短路

> 有序实现检查清单。两个文件、两个关注点。每阶段完成后运行验证命令。
> `workspace-templates.ts` 是大文件，改动前务必 grep 定位行号。

## 阶段 0：前置确认

- [ ] 0.1 通读 prd.md / design.md，确认窗口语义化方案、读完短路机制、AI-facing 清理边界无歧义
- [ ] 0.2 确认 `task.py current` 指向本任务（或尚未 start，后续 start 做）
- [ ] 0.3 确认当前分支干净（当前在 `feat/timeline-orbit-svg-polish`，有 2 个未提交改动——需先处理或确认可共存）

## 阶段 1：窗口语义化（workspace-templates.ts）

> 先改运行时逻辑，再改 AI-facing 文案。改前 grep 确认行号。

- [ ] 1.1 `windowSize` 10 → 15
  - 定位：`rg -n "windowSize = 10" apps/platform-web/src/storage/workspace-templates.ts`（约 L1496）
  - 改为 `const windowSize = 15;`
- [ ] 1.2 脚本注释更新（约 L1480）
  - 旧："读 frontier.json 当前 sourceWindow，计算下一段 10 章，读对应章节文本。"
  - 新："读 frontier.json 当前 sourceWindow，计算下一段最多 15 章，读对应章节文本。"
- [ ] 1.3 `read_frontier_window` action description 更新（约 L1449）
  - 旧："读 frontier.json 当前 sourceWindow，计算下一段 10 章窗口，读 save/source/chapters/ 下对应章节文本，返回章节文本与 frontier 状态。只读不写。"
  - 新："读 frontier.json 当前 sourceWindow，计算下一段最多 15 章窗口，读 save/source/chapters/ 下对应章节文本，返回章节文本与 frontier 状态。只读不写。"
- [ ] 1.4 Skill 推进流程步骤 1 更新（约 L1407）
  - 旧："1. `read_frontier_window` → 读当前 frontier.json 的 sourceWindow，计算下一段 10 章窗口，读 `save/source/chapters/` 下对应章节，返回章节文本 + frontier 状态。"
  - 新："1. `read_frontier_window` → 读当前 frontier.json 的 sourceWindow，计算下一段最多 15 章窗口，读 `save/source/chapters/` 下对应章节，返回章节文本 + frontier 状态。"
- [ ] 1.5 重写"窗口限制"段为"窗口与节点"段（约 L1435-1439）
  - 旧（3 行）：
    ```
    ## 窗口限制
    - 固定 10 章窗口。
    - 过去章节不倒回搜索。
    - 窗口外不读。
    ```
  - 新：
    ```
    ## 窗口与节点
    - 单次推进最多读 15 章（硬上限，防止大节点一次吞太多章节）。
    - 语义目标：覆盖至少 1-2 个剧情节点后即可提交 sourceWindow.end，不必读到上限。
    - 上限内读不到 2 个完整节点时，提交到上限章节，就已有显著变化点建锚点，剩余节点延续到下次推进。
    - sourceWindow.end 由你语义决定，可小于实际读到的最后一章。
    - 超出 sourceWindow.end 的章节仅供判断"是否还有下一个剧情节点"使用，不从中抽实体、不建 source 锚点（spoiler-safe）。
    - 窗口还受总字符数兜底（约 12 万字），长章节小说实际读到的章数可能少于 15——以 read_frontier_window 返回的 window.end 为准。
    - 过去章节不倒回搜索。窗口外不读。
    ```
- [ ] 1.6 source 锚点建立规范段补充一行（约 L1427-1433 段末）
  - 在"order 赋值"行后补充："锚点的 chapter 必须落在你提交的 sourceWindow 范围内（脚本会校验）。"
- [ ] V1: `rg -n "10 章|10章|固定.*10" apps/platform-web/src/storage/workspace-templates.ts` — 确认无残留

## 阶段 2：读完短路（useFrontierAdvance.ts）

> 先改数据结构，再改流程逻辑。

- [ ] 2.1 `TriggerState` 接口新增 `exhausted: boolean`（约 L52-71）
  - 在 `version` 后加 `exhausted: boolean`
- [ ] 2.2 `defaultTriggerState()` 返回 `exhausted: false`（约 L73-75）
- [ ] 2.3 `loadTriggerState` 对旧存档兜底 `exhausted: false`（约 L78-93）
  - 在返回对象的字段列表加 `exhausted: typeof parsed.exhausted === "boolean" ? parsed.exhausted : false`
- [ ] 2.4 重排 `checkFrontierAdvance` 流程：trigger-state 提前读取 + exhausted 短路
  - 当前流程（L136-214）：isInFlight → 读 runtime → 读 frontier → 读 manifest → 读 trigger-state → 去重 → 条件1 → 条件2
  - 改后流程：isInFlight → **读 trigger-state → exhausted 短路** → 读 runtime → 读 frontier → 读 manifest → 去重 → 条件1 → 条件2
  - 具体改动：
    - 将 L179-180 的 `loadTriggerState` 调用移到 L136（isInFlight 判断后）
    - 在 loadTriggerState 后加：`if (triggerState.exhausted) return`
    - 删除原 L179-180 的重复调用
    - 注意：`triggerState.lastChecked` 更新（L182-189）依赖 runtime/frontier 数据，需移到读取这些数据之后
- [ ] 2.5 条件 2 命中时置 `exhausted = true` 并持久化（约 L210-214）
  - 旧：`if (totalChapters <= 0 || sourceWindowEndNum >= totalChapters) { await saveTriggerState(...); return }`
  - 新：`if (totalChapters <= 0 || sourceWindowEndNum >= totalChapters) { triggerState.exhausted = true; await saveTriggerState(...); return }`
- [ ] V2: `npm run build --workspace @tsian/play-frontend-dev` — 确认编译通过

## 阶段 3：最终验证

- [ ] 3.1 `npm run build --workspace @tsian/platform-web` — 确认 workspace-templates.ts 改动编译通过
- [ ] 3.2 `npm run build --workspace @tsian/play-frontend-dev` — 确认 useFrontierAdvance.ts 改动编译通过
- [ ] 3.3 人工审查 Skill 文案：确认语义节点驱动表述清晰，无"固定"字样残留
- [ ] 3.4 人工审查短路逻辑：确认 exhausted 路径只读 trigger-state，不读其他文件

## 风险与注意事项

- **`workspace-templates.ts` 行号漂移**：大文件，改一处可能影响后续行号。每步改前 grep 确认。
- **流程重排的 lastChecked 更新**：`triggerState.lastChecked`（L182-189）需要 runtime/frontier 数据。流程重排后，trigger-state 读取提前，但 lastChecked 更新仍需在 runtime/frontier 读取之后。不要把 lastChecked 更新也提前。
- **exhausted 短路不更新 lastChecked**：exhausted 短路 return 时不更新 lastChecked（没有 runtime 数据可记）。这是可接受的——exhausted 状态下 lastChecked 不再有意义。
