# Research Notes (internal — for spec-research/spec-plan handoff)

> Captured 2026-05-09 during `/ccg:spec-research`. Used to feed `tasks.md` /
> `design.md` / spec deltas. Do NOT delete until change is archived.

## 1. Codebase Facts (Verified by Read/Grep)

### Existing Hardcoded Pipeline

- `apps/platform-web/src/platform-host/index.ts` (1076 lines)
  - `interaction.sendMessage` (line 953-1006): the only entry triggering a turn
    - Loads history / events / archives / mod / playerArchiveIds
    - Calls `assembleRetrievalContext({...})` → produces `retrieval.prompt` + `retrieval.debug`
    - Calls `runtimeEngine.sendMessageWithContext(input, { prompt: retrieval.prompt })`
    - Calls `persistActiveSnapshot({ maintenanceMessages, maintenanceArchiveNames, narrativeTimeText })`
  - `persistActiveSnapshot` (line 703-769):
    - Calls `generateMaintenancePatch({ currentTime, narrativeTimeText, globals, messages, activeEvents, archives })`
    - Applies patch via `runtimeEngine.applyRuntimeStatePatch({ currentTime, globals })` + `applyArchivePatchesForSave` + `applyEventPatchForSave`
    - Saves snapshot/history + creates checkpoint with `reason: "after-turn"`
- `apps/platform-web/src/runtime-host/engine.ts` (135 lines)
  - `LocalRuntimeEngine.sendMessageWithContext({ prompt })` — single inject point for chat AI prompt (line 38-94)
  - `applyRuntimeStatePatch({ currentTime, globals })` — public method for maintenance to write currentTime/globals
- `apps/platform-web/src/runtime-host/retrieval.ts` (1319 lines)
  - `assembleRetrievalContext(input)` — returns `{ prompt: string, debug: RetrievalDebugRecord }`
  - Two-stage: scoring (events/archives ranking, semantic, hint) + prompt string assembly
  - Uses `BrowserRetrievalSettings` (20+ knobs) from `config/ai.ts`
- `apps/platform-web/src/runtime-host/maintenance.ts` (369 lines)
  - `buildMaintenancePrompt(input)` — string concat of currentTime/globals/events/archives + 50 lines of hardcoded JSON schema rules
  - `generateMaintenancePatch()` — calls `generateAssistantReply` → `extractJsonObject` → normalize
- `apps/platform-web/src/runtime-host/ai.ts` — `generateAssistantReply(messages, { debugLabel })` is the only AI call exit
- `apps/platform-web/src/bridge/play-frontend-bridge.ts` — base bridge that platform-host extends
- `apps/platform-web/src/config/ai.ts` (423 lines) — config draft + `getBrowserRetrievalSettings()`
- `packages/contracts/src/runtime.ts` (177 lines) — `MaintenancePatchDocument`, `ArchivePatchItem`, `EventPatchItem`, `RuntimeWriteRequest`
- `packages/contracts/src/bridge.ts` — `PlayFrontendBridge.interaction.sendMessage()` is the public entry
- `builtin/mods/index.ts` — registers `greySaltTownMod`; `getBuiltinMod(modId)` lookup
- `builtin/mods/grey-salt-town/src/` — mod manifest + initial save payload

### fast-tavern Source Inventory (F:/workspace/.tsian-research/fast-tavern/npm-fast-tavern/src/)

Total ~2796 lines, 33 TS files, zero runtime deps.

**Core types** — `core/types.ts` (380 lines): `Role`, `RegexScriptData`, `WorldBookEntry`, `WorldBook`,
`PromptInfo`, `PresetInfo`, `UtilityPrompts`, `CharacterCard` (must strip), `RegexTarget`, `RegexView`,
`RegexMacroMode`, `WorldBookEntryActivationMode`.

**Convert** — `core/convert.ts` (56 lines): top-level `convert()` orchestrator.

**Modules** (each isolated):
- `core/modules/history/factories.ts` (20 lines), `guards.ts` (14)
- `core/modules/worldbook/getActiveEntries.ts` (198) — keyword/always activation
- `core/modules/regex/applyRegex.ts` (179), `mergeRegexRules.ts` (18)
- `core/modules/macro/replaceMacros.ts` (72) — `{{macro}}` substitution; takes `Record<string,string>`
- `core/modules/assemble/assembleTaggedPromptList.ts` (149) — composes prompts in order
- `core/modules/build/buildPrompt.ts` (225), `buildPromptFromSillyTavern.ts` (50)
- `core/modules/inputs/convertFromSillyTavern.ts` (784) — main ST → engine adapter (HEAVY)
- `core/modules/inputs/normalizeWorldbooks.ts` (145), `normalizeRegexes.ts` (136)
- `core/modules/pipeline/processContentStages.ts` (42), `compileTaggedStages.ts` (56)
- `core/modules/variables/variableContext.ts` (256) — variable scope (local/global)
- `core/channels/` — gemini/openai/text/tagged adapters (LIKELY KEEP openai + text only)

**Strip targets**: CharacterCard fields/branches in `convertFromSillyTavern.ts` & `types.ts` (Tsian replaces with mod
manifest), Group Chat & Quick Reply if any (none seen), maybe Gemini channel if Tsian only goes through OpenAI-shaped
endpoint.

## 2. Constraint Set (Authoritative)

### Hard Constraints (cannot violate)

**HC-1 Sandbox invariant**: Mod-registered nodes (especially `compute`) MUST NOT obtain RuntimeEngine reference,
MUST NOT write runtime data. Only platform-built `apply-patch` writes runtime. (User decision)

**HC-2 Single AI exit**: All AI calls MUST go through one preset entry — no schema-protection layer at platform.
AI output contract enforced by prompt; malformed output → frontend throws → triggers node retry.

**HC-3 Mod manifest replaces workflow wholesale**: `manifest.workflow` overrides default workflow in entirety;
no partial-merge in prototype. (G-①+② decision: platform default as fallback only.)

**HC-4 Reactive outputs store**: Engine.execute returns Vue 3 reactive ref. `result` nodes write into it. Frontends
watch — must NOT know workflow engine exists.

**HC-5 Node-level independent failure**: Failed node does NOT block sibling nodes. Downstream consumers handle
"未到达". Next user input aborts all unfinished nodes from previous turn.

**HC-6 Extraction rules minimal**: Only `tag | regex | raw` + optional `parse: "json" | "number"`. No nested
JSONPath, no expression eval, no compute placeholders, no mod-registered placeholder callbacks.

**HC-7 Edge-injected inputs**: Nodes do NOT declare `inputs` schema. Edges connect `from.outputName` → `to.varName`,
varName is injected as macro into downstream prompt. (Constraint b)

**HC-8 result nodes declare workflow output**: No top-level `workflow.outputs` field. Workflow's external surface
is the union of `type='result'` node names + values. (Constraint c)

**HC-9 fail loud > fail silent** (AGENTS.md §7): No silent fallbacks. Tri-question rule (must happen? immediately
visible? worth maintenance?) before adding any default-value path.

**HC-10 No data migration / compatibility layer** (AGENTS.md §7): Prototype period — IndexedDB destructive change
allowed; rebuild local data rather than ship migrations.

**HC-11 Custom macros via path mapping only**: Mod declares `customMacros: { name: "globals.path" }`; engine resolves
by path lookup at injection time. No expression eval, no callback registration.

**HC-12 Mod custom runtime data lives in globals**: Mod cannot create new runtime namespaces — extra state goes
under `globals.*`.

**HC-13 Platform owns apply-patch**: Mod cannot register a `type='apply-patch'` node. Type registry rejects.
Writing runtime is platform-only authority. **修订（2026-05-10）：**写运行时收口在
`apps/platform-web/src/runtime-host/patch-applier.ts` 的 `applyMaintenancePatch()` 函数；`apply-patch` 节点与
桥 API `bridge.runtime.applyPatch` 都是它的客户端，不可绕过。

**HC-14 桥 API 写运行时复用 patch 应用器**：`bridge.runtime.applyPatch` / `updateGlobals` / `appendUserMessage` /
`appendAssistantMessage` 都必须转调 `patch-applier.ts` 中的同一份函数；任何前置校验 / 后置 hook 都放在
`applyMaintenancePatch` 内部，不允许其中一个调用方包一层差异化逻辑。fail loud 单点收口。

**HC-15 前端 vs compute 权限非对等**：模组前端代码（在浏览器渲染层）可以调桥 API 写运行时；`compute` 节点（在工作流引擎中）
仍然不能拿 RuntimeEngine 引用、不能调桥 API、不能写运行时（HC-1 不变）。理由：前端代码是模组开发者向玩家明确暴露的 UI 层
逻辑，调用都是玩家可见的；compute 节点是工作流内部黑盒，写运行时会让 AI 链路非确定性放大。

### Soft Constraints (conventions)

**SC-1 fast-tavern source-copy not npm**: Vendor in `packages/prompt-engine`, no npm dep, allows local edits.
**SC-2 Drop CharacterCard / GroupChat / QuickReply**: Tsian uses mod manifest + workflow instead.
**SC-3 Lorebook ⊥ retrieval**: Lorebook = static on-demand injection (worldbook setup, skill templates, local
persona, tool patterns); Tsian retrieval = dynamic narrative memory (events/archives/globals). Different macro
namespaces; if not needed, leave empty.
**SC-4 macros: Record<string, string>**: Use fast-tavern's existing `macros` extension hook for Tsian-specific
placeholders (currentTime, globals.x, archives.x, events.recent, userInput, lastReply, etc.).
**SC-5 Vue 3 reactive (not Pinia)**: Outputs store should be a `ref` / `shallowRef` — Pinia is over-engineered for
single-turn lifecycle data. Use `shallowRef<Record<string, OutputState>>` to avoid deep-watching node payloads.
**SC-6 compute timeout default 5000ms**: Configurable via `config.timeout`.
**SC-7 Token-level streaming reserved but not implemented**: API surface should accept callbacks but emit only on
final result for now.

### Dependencies

**D-1 Workflow engine ↔ prompt engine**: `ai-call` node calls prompt engine's `assemblePromptFromPreset({ presetId,
macros, lorebook? })` to produce final messages. Workflow engine must accept prompt engine handle.

**D-2 apply-patch ↔ MaintenancePatchDocument**: `apply-patch` node consumes JSON shaped exactly like
`MaintenancePatchDocument` (already in contracts). Same parser code as current `maintenance.ts` `normalize*`
moves into the node.

**D-3 Engine refactor unblocks Engine F (frontend bridge API consolidation)**: After `LocalRuntimeEngine` sheds
`sendMessageWithContext`, the bridge surface simplifies. Stage F can run in parallel.

**D-4 retrieval keeps scoring, sheds prompt-string assembly**: `assembleRetrievalContext` returns structured outputs
(events list / archive list / debug record) — node consumers turn it into prompt text via macros.

### Risks

**R-1 fast-tavern's `convertFromSillyTavern.ts` (784 lines) is heavy and tightly coupled to CharacterCard**: Stripping
may regress preset parsing. Mitigation: keep file but make CharacterCard arg optional/null, add adapter test fixture
(at least one real ST preset.json round-trip).

**R-2 DAG cycle detection / deadlock**: User can author cyclic edges. Mitigation: validation pass at workflow load —
reject cycles loud (HC-9).

**R-3 Reactive store leak across turns**: If nodes write to a long-lived ref, next turn's overwrites might mix with
in-flight aborted nodes. Mitigation: per-turn ref instance + AbortController for all node promises; engine returns
`{ outputs, abort }`, abort kills pending promises and replaces ref.

**R-4 Compute node escape**: User-supplied JS executes in main thread, can `await fetch(...)`, touch DOM, etc.
Mitigation (prototype): timeout + try/catch + community review. Future: Web Worker / QuickJS.

**R-5 macro collision**: fast-tavern uses `{{name}}` and `<<name>>`; Tsian wants `{{nodeId.portName}}` for upstream
output injection. Solutions: (a) use `{{node:id.port}}` with namespace prefix; (b) use a different delimiter
`<<<id.port>>>`; (c) reserve `nodeId.portName` in macro Record<string,string> at injection time (since fast-tavern's
macro is just KV substitution, dot-paths in the key work). RECOMMEND (c) — keeps fast-tavern unchanged.

**R-6 Maintenance default workflow regression**: Default workflow must reproduce current 3-stage behavior exactly
on day-1 (otherwise grey-salt-town breaks). Mitigation: write default workflow JSON that mirrors current logic, test
with same input/output as before refactor.

### Success Criteria (verifiable)

**SC-CRIT-1**: `npm run build:contracts && build:runtime-core && build:web` all green after refactor.

**SC-CRIT-2**: Browser manual run of grey-salt-town reproduces current 3-stage behavior (retrieval → reply →
maintenance) using the new default workflow + builtin-presets, no regression in checkpoints / events / archives.

**SC-CRIT-3**: A test mod can declare a 5-node workflow (e.g. retrieval → 2 parallel chat AIs → switch → result)
and have it execute end-to-end with reactive outputs visible in debug panel.

**SC-CRIT-4**: A test preset.json from real SillyTavern community pack loads and runs without throwing.

**SC-CRIT-5**: `compute` node with `setTimeout(()=>{}, 99999)` is killed at 5000ms, error reported, downstream
gracefully sees missing output.

**SC-CRIT-6**: Mod that tries to register a `apply-patch` typed node is rejected at workflow load with loud error.

**SC-CRIT-7**: Next-turn submit while previous turn still running aborts old promises (verifiable via debug log
showing "aborted N nodes").

## 3. Open Questions Resolved by User Brief (Plan-γ + 8 已对齐决策)

All 11 expected outputs from §6 of brief are addressed in `design.md`. User has explicitly aligned on:
- Plan-γ all-open
- Replace, not patch, workflows
- Dynamic tag-extraction ports (Plan W)
- 5 builtin types + reserved port for mod registration
- Full sandbox; macros via path mapping
- Reactive outputs
- compute single-arg `({ inputs, macros })`, async-supported
- apply-patch platform-only

No remaining ambiguity needing AskUserQuestion.

## 4. Spec Deltas Plan (for spec-plan stage)

New capabilities:

- `openspec/specs/prompt-engine/spec.md` — preset assembly contract, macro contract, lorebook activation contract
- `openspec/specs/workflow-engine/spec.md` — node types, edge semantics, execution model, failure model, output store

Modified capabilities (delta files):

- `apps/platform-web/runtime-host` — surface change: drop `sendMessageWithContext`, add atomic methods
- `apps/platform-web/platform-host` — `sendMessage` orchestration replaced by workflow execution
- `packages/contracts` — add `Workflow*` types, extend `ModManifest`

## 5. Next Step

User: run `/ccg:spec-plan` to produce zero-decision step-by-step plan + tasks.md.

## 6. 范围扩展（2026-05-10）

主人认可浮浮酱"前端交互式玩法路径"建议，将以下纳入本次 change：

- 阶段 I：前端写运行时桥 API（`bridge.runtime.applyPatch / updateGlobals / appendUserMessage / appendAssistantMessage`）
- patch 应用器抽离为 `apps/platform-web/src/runtime-host/patch-applier.ts`，`apply-patch` 节点与桥 API 共用
- 数据回流统一走 `globals / archives / events`，不引入"前端临时数据袋"
- 决策：A-1（桥 API 复用应用器）+ B-2 拆下一个 change（fragment 触发不在本次） + C-1（统一走 globals） + D-1 局部（A 入本次）

明确仍**不在本次**：

- 前端按 nodeId / fragmentId 触发子工作流（B-2）
- 前端临时变量袋（C-2）
- 模组自定义"写运行时"节点

参考：`design.md` §12 / `proposal.md` What Changes / `tasks.md` Phase I。
