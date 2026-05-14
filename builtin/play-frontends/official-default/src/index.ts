import type {
  ArchiveRecord,
  ConversationMessageRecord,
  EventRecord,
  ModStaticContent,
  PlayFrontendBridge,
  PlayFrontendManifest,
  RuntimeSnapshotShell,
} from "@tsian/contracts"

interface RetrievalCandidateDebugRecord {
  id: string
  time: string
  status: string
  tags: string[]
  keywordScore: number
  semanticScore: number | null
  finalScore: number
  selected: boolean
  content: string
}

interface RetrievalArchiveDebugRecord {
  id: string
  name: string
  presence: string
  score: number
  source?: "direct" | "present" | "event" | "bridge" | "semantic"
}

interface RetrievalCatalogEventDebugRecord {
  id: string
  name: string
  score: number
  selected: boolean
  content: string
  guidance?: string
}

interface RetrievalSemanticDebugRecord {
  enabled: boolean
  keywords: string[]
  eventIds: string[]
  archiveIds: string[]
  error?: string
}

interface RetrievalDebugRecord {
  input: string
  settings?: Record<string, unknown>
  semantic?: RetrievalSemanticDebugRecord
  directEntities: string[]
  presentEntities?: string[]
  linkedEntities: string[]
  groups: string[][]
  candidates: RetrievalCandidateDebugRecord[]
  archives: RetrievalArchiveDebugRecord[]
  catalogEvents?: RetrievalCatalogEventDebugRecord[]
}

interface AiDebugRecord {
  id: string
  kind: "chat" | "embedding"
  label: string
  model: string
  createdAt: string
  messages?: ConversationMessageRecord[]
  input?: string[]
  responseText?: string
  vectorCount?: number
  dimensions?: number
  error?: string
}

interface CheckpointSummary {
  id: string
  turn: number
  label: string
  reason: "initial" | "after-turn" | "manual"
  createdAt: number
  messageCount: number
  eventCount: number
  archiveCount: number
}

type InspectorTab = "ai" | "retrieval" | "events" | "archives" | "checkpoints" | "snapshot" | "workflow"

const STYLE_ID = "tsian-official-default-style"
const ROLE_LABEL: Record<string, string> = {
  user: "玩家",
  assistant: "叙事 AI",
  system: "系统",
}

export const manifest: PlayFrontendManifest = {
  id: "official-default",
  name: "Official Default Frontend",
  version: "0.0.0",
  entry: "./src/index.ts",
  runtimeVersion: "0.0.0",
}

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) {
    return
  }

  const style = document.createElement("style")
  style.id = STYLE_ID
  style.textContent = `
    .official-default-frontend{--bg:rgba(9,15,24,.82);--bg2:rgba(7,12,20,.95);--line:rgba(148,163,184,.16);--text:#e6edf8;--muted:#8ea2bb;--gold:#f6b94f;display:grid;gap:18px;color:var(--text);font-family:"Source Han Sans SC","Noto Sans SC","Microsoft YaHei",sans-serif}
    .official-default-frontend *{box-sizing:border-box;min-width:0}
    .od-hero,.od-panel{border:1px solid var(--line);border-radius:24px;background:linear-gradient(180deg,rgba(12,19,31,.96),rgba(7,11,18,.96));box-shadow:0 22px 48px rgba(2,6,23,.18)}
    .od-hero{padding:22px 24px;background:radial-gradient(circle at top right,rgba(246,185,79,.18),transparent 28%),linear-gradient(180deg,rgba(12,19,31,.98),rgba(7,11,18,.96))}
    .od-eye{margin:0;color:var(--gold);font-size:11px;letter-spacing:.24em;text-transform:uppercase}
    .od-title{margin:8px 0 10px;font-family:"Iowan Old Style","Noto Serif SC","Source Han Serif SC",serif;font-size:clamp(30px,4vw,42px);line-height:1.04}
    .od-summary{margin:0;color:#c6d3e2;font-size:15px;line-height:1.75}
    .od-mod-overview{margin-top:16px}
    .od-mod-card{padding:16px 18px;border:1px solid rgba(148,163,184,.12);border-radius:18px;background:rgba(8,15,24,.46)}
    .od-mod-title{margin:8px 0 0;font-size:18px;line-height:1.35}
    .od-mod-summary{margin-top:10px;font-size:14px;line-height:1.75}
    .od-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:16px}
    .od-stat{padding:14px 16px;border:1px solid rgba(148,163,184,.12);border-radius:16px;background:rgba(8,15,24,.46)}
    .od-stat span{display:block;color:var(--muted);font-size:11px;letter-spacing:.12em;text-transform:uppercase}
    .od-stat strong{display:block;margin-top:8px;font-size:15px}
    .od-scene{display:grid;grid-template-columns:minmax(220px,.78fr) minmax(0,1.22fr);gap:12px;margin-top:14px}
    .od-scene-time,.od-scene-item{padding:14px 16px;border:1px solid rgba(148,163,184,.12);border-radius:16px;background:rgba(8,15,24,.46)}
    .od-scene-time span,.od-scene-item span{display:block;color:var(--muted);font-size:11px;letter-spacing:.12em;text-transform:uppercase}
    .od-scene-time strong,.od-scene-item strong{display:block;margin-top:8px;font-size:15px;line-height:1.6}
    .od-scene-status{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}
    .od-layout{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(320px,.95fr);gap:18px;align-items:start}
    .od-panel{display:flex;flex-direction:column;min-height:0;overflow:hidden}
    .od-panel--play{height:min(820px,calc(100vh - 32px))}
    .od-panel--inspector{height:min(960px,calc(100vh - 32px))}
    .od-head{padding:18px 20px;border-bottom:1px solid var(--line)}
    .od-head h3{margin:0;font-family:"Iowan Old Style","Noto Serif SC","Source Han Serif SC",serif;font-size:24px}
    .od-head p{margin:8px 0 0;color:var(--muted);font-size:13px;line-height:1.6}
    .od-history{flex:1;min-height:280px;overflow:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:14px;padding:20px;background:linear-gradient(180deg,rgba(8,15,24,.18),rgba(8,15,24,.08));scrollbar-color:rgba(246,185,79,.38) rgba(8,15,24,.64)}
    .history-item{max-width:88%;padding:16px 18px;border:1px solid rgba(148,163,184,.12);border-radius:18px;background:var(--bg)}
    .history-item--user{align-self:flex-end;background:linear-gradient(180deg,rgba(246,185,79,.16),rgba(246,185,79,.06)),rgba(12,18,28,.98);border-color:rgba(246,185,79,.18)}
    .history-item--assistant{align-self:flex-start;background:linear-gradient(180deg,rgba(117,184,255,.12),rgba(117,184,255,.04)),rgba(10,16,26,.98)}
    .history-item--system{align-self:center;max-width:100%;border-style:dashed}
    .od-role{display:block;margin-bottom:10px;color:var(--gold);font-size:11px;letter-spacing:.16em;text-transform:uppercase}
    .od-body{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:15px;line-height:1.8}
    .od-composer{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;padding:18px 20px 20px;border-top:1px solid var(--line);background:var(--bg2)}
    .composer-input{width:100%;min-height:56px;padding:16px 18px;border:1px solid rgba(148,163,184,.16);border-radius:18px;background:rgba(10,17,28,.94);color:var(--text);font:inherit}
    .composer-input:focus{outline:none;border-color:rgba(246,185,79,.42);box-shadow:0 0 0 4px rgba(246,185,79,.08)}
    .composer-button{min-width:132px;padding:0 20px;border:1px solid rgba(246,185,79,.24);border-radius:18px;background:linear-gradient(180deg,rgba(246,185,79,.22),rgba(246,185,79,.08)),rgba(15,22,34,.96);color:#fff7ea;font:inherit;font-weight:600;cursor:pointer}
    .od-tabs{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:8px;padding:14px 16px 0;background:rgba(255,255,255,.02)}
    .od-tab{padding:12px 10px;border:1px solid rgba(148,163,184,.12);border-radius:14px 14px 0 0;background:rgba(8,15,24,.56);color:var(--muted);font:inherit;font-size:13px;cursor:pointer}
    .od-tab.is-active{color:var(--text);border-color:rgba(246,185,79,.2);background:linear-gradient(180deg,rgba(246,185,79,.12),rgba(246,185,79,0)),rgba(10,16,26,.96)}
    .od-tabpanes{flex:1;min-height:0;overflow:hidden;background:rgba(7,12,20,.72)}
    .od-pane{display:none;height:100%;overflow:auto;padding:18px;overscroll-behavior:contain}
    .od-pane.is-active{display:grid;align-content:start;gap:14px}
    .od-card,.event-item,.archive-item,.retrieval-item{padding:16px;border:1px solid var(--line);border-radius:18px;background:var(--bg)}
    .retrieval-item.is-selected{border-color:rgba(246,185,79,.24);background:linear-gradient(180deg,rgba(246,185,79,.1),rgba(246,185,79,0)),rgba(10,16,26,.98)}
    .od-k{margin:0 0 10px;color:var(--muted);font-size:12px;letter-spacing:.08em;text-transform:uppercase}
    .od-pre,.od-field p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px;line-height:1.75}
    .od-field{display:grid;gap:6px}
    .od-field span{color:var(--muted);font-size:12px;letter-spacing:.06em;text-transform:uppercase}
    .od-row{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
    .od-row h4{margin:0;font-size:15px}
    .od-meta{margin:0;color:var(--muted);font-size:12px;text-align:right;line-height:1.6}
    .ai-message{display:grid;gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid rgba(148,163,184,.1)}
    .ai-message:first-of-type{border-top:0;padding-top:0}
    .ai-label{display:inline-flex;width:max-content;padding:4px 8px;border-radius:999px;background:rgba(117,184,255,.12);color:#b0d6ff;font-size:12px}
    .od-chips{display:flex;flex-wrap:wrap;gap:8px}
    .od-chip{display:inline-flex;align-items:center;padding:6px 10px;border-radius:999px;background:rgba(246,185,79,.12);color:#f1d7a1;font-size:12px}
    .od-chip--soft{background:rgba(117,184,255,.12);color:#b0d6ff}
    .od-empty{margin:0;padding:16px;border:1px dashed var(--line);border-radius:18px;color:var(--muted);background:rgba(8,15,24,.3);font-size:13px}
    @media (max-width:1080px){.od-layout{grid-template-columns:1fr}.od-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.od-scene{grid-template-columns:1fr}.od-panel--play,.od-panel--inspector{height:auto;max-height:none}.od-history{max-height:58vh}}
    @media (max-width:720px){.od-stats,.od-tabs,.od-composer{grid-template-columns:1fr}.od-tabs{grid-template-columns:repeat(2,minmax(0,1fr))}.history-item{max-width:100%}.od-hero,.od-head{padding:18px}}
  `
  document.head.append(style)
}

function empty(text: string): HTMLParagraphElement {
  const node = document.createElement("p")
  node.className = "od-empty"
  node.textContent = text
  return node
}

function turn(snapshot: RuntimeSnapshotShell): number {
  const value = snapshot.state.turn
  return typeof value === "number" ? value : 0
}

function currentTime(snapshot: RuntimeSnapshotShell): string {
  return typeof snapshot.state.currentTime === "string" && snapshot.state.currentTime.trim()
    ? snapshot.state.currentTime.trim()
    : ""
}

function formatTime(value: string): string {
  if (!value) {
    return "未设置"
  }

  const narrativeMatch = value.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/)
  if (narrativeMatch) {
    const [, year, month, day, hour, minute] = narrativeMatch
    return `${year}年${Number(month)}月${Number(day)}日 ${hour}:${minute}`
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const day = date.getDate()
  const hour = String(date.getHours()).padStart(2, "0")
  const minute = String(date.getMinutes()).padStart(2, "0")
  return `${year}年${month}月${day}日 ${hour}:${minute}`
}

function formatGlobalValue(value: unknown): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value)
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function runtimeGlobals(snapshot: RuntimeSnapshotShell): Array<[string, string]> {
  const raw = snapshot.state.globals
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return []
  }

  return Object.entries(raw).flatMap(([key, value]) => {
    if (!key.trim()) {
      return []
    }

    return [[key.trim(), formatGlobalValue(value)] as [string, string]]
  })
}

function renderModOverview(target: HTMLDivElement, mod: ModStaticContent | null) {
  target.replaceChildren()

  if (!mod) {
    target.append(empty("当前没有装载模组静态内容。"))
    return
  }

  const card = document.createElement("article")
  card.className = "od-mod-card"
  card.innerHTML = `
    <div class="od-row">
      <div>
        <p class="od-eye">Active Mod</p>
        <h3 class="od-mod-title"></h3>
      </div>
      <p class="od-meta"></p>
    </div>
    <p class="od-summary od-mod-summary"></p>
    <div class="od-chips"></div>
  `

  ;(card.querySelector(".od-mod-title") as HTMLHeadingElement).textContent = mod.manifest.name
  ;(card.querySelector(".od-meta") as HTMLParagraphElement).textContent = [
    mod.manifest.id,
    mod.manifest.version,
  ].join(" · ")
  ;(card.querySelector(".od-mod-summary") as HTMLParagraphElement).textContent =
    mod.manifest.description || "当前模组未提供描述。"

  const chips = card.querySelector(".od-chips") as HTMLDivElement
  ;[
    `前端：${mod.frontendConfig.frontendId ?? "未指定"}`,
    `实体类型：${mod.entityTypeDefinitions.length}`,
    `预设档案：${mod.archiveCatalog.length}`,
    `预设事件：${mod.eventCatalog.length}`,
  ].forEach((text) => {
    const chip = document.createElement("span")
    chip.className = "od-chip od-chip--soft"
    chip.textContent = text
    chips.append(chip)
  })

  target.append(card)
}

function renderSceneStatus(
  timeTarget: HTMLElement,
  statusTarget: HTMLDivElement,
  snapshot: RuntimeSnapshotShell,
) {
  timeTarget.textContent = formatTime(currentTime(snapshot))
  statusTarget.replaceChildren()

  const entries = runtimeGlobals(snapshot)
  if (entries.length === 0) {
    statusTarget.append(empty("当前还没有运行时状态。"))
    return
  }

  entries.forEach(([key, value]) => {
    const card = document.createElement("article")
    card.className = "od-scene-item"
    card.innerHTML = `<span></span><strong></strong>`
    ;(card.querySelector("span") as HTMLSpanElement).textContent = key
    ;(card.querySelector("strong") as HTMLElement).textContent = value
    statusTarget.append(card)
  })
}

function renderSnapshot(target: HTMLDivElement, snapshot: RuntimeSnapshotShell) {
  target.replaceChildren()
  const card = document.createElement("article")
  card.className = "od-card"
  card.innerHTML = `<p class="od-k">Runtime Snapshot</p><pre class="od-pre"></pre>`
  ;(card.querySelector("pre") as HTMLPreElement).textContent = JSON.stringify(snapshot, null, 2)
  target.append(card)
}

function renderCheckpoints(
  target: HTMLDivElement,
  items: CheckpointSummary[],
  onRestore: (checkpointId: string) => void,
) {
  target.replaceChildren()
  if (items.length === 0) {
    target.append(empty("当前还没有可回溯的状态切片。"))
    return
  }

  for (const item of items) {
    const card = document.createElement("article")
    card.className = "od-card"
    card.innerHTML = `
      <div class="od-row">
        <h4></h4>
        <p class="od-meta"></p>
      </div>
      <div class="od-field"><span>切片内容</span><p></p></div>
      <button class="composer-button checkpoint-restore" type="button">恢复到这里</button>
    `
    ;(card.querySelector("h4") as HTMLHeadingElement).textContent = item.label
    ;(card.querySelector(".od-meta") as HTMLParagraphElement).textContent = `${formatTime(
      new Date(item.createdAt).toISOString(),
    )} · ${item.reason}`
    ;(card.querySelector(".od-field p") as HTMLParagraphElement).textContent =
      `回合 ${item.turn} · ${item.messageCount} 条对话 · ${item.eventCount} 个事件 · ${item.archiveCount} 个档案`
    ;(card.querySelector("button") as HTMLButtonElement).addEventListener("click", () => {
      onRestore(item.id)
    })
    target.append(card)
  }
}

function renderHistory(target: HTMLDivElement, items: ConversationMessageRecord[]) {
  target.replaceChildren()
  if (items.length === 0) {
    target.append(empty("还没有对话记录。"))
    return
  }

  for (const item of items) {
    const row = document.createElement("article")
    row.className = `history-item history-item--${item.role}`
    row.innerHTML = `<span class="od-role">${ROLE_LABEL[item.role] ?? item.role}</span><p class="od-body"></p>`
    ;(row.querySelector("p") as HTMLParagraphElement).textContent = item.content
    target.append(row)
  }
}

function renderEvents(target: HTMLDivElement, items: EventRecord[]) {
  target.replaceChildren()
  if (items.length === 0) {
    target.append(empty("当前还没有事件。"))
    return
  }

  for (const item of items) {
    const row = document.createElement("article")
    row.className = "event-item"
    row.innerHTML = `
      <div class="od-row">
        <h4>${item.status === "ongoing" ? "进行中的事件" : "已完成事件"}</h4>
        <p class="od-meta"></p>
      </div>
      <div class="od-chips"></div>
      <div class="od-field"><span>强绑定档案 ID</span><p class="event-ids"></p></div>
      <div class="od-field"><span>正文</span><p></p></div>
    `
    ;(row.querySelector(".od-meta") as HTMLParagraphElement).textContent = `${formatTime(
      item.time,
    )}${item.id ? ` · ${item.id}` : ""}`
    const chips = row.querySelector(".od-chips") as HTMLDivElement
    if (item.entityTags.length > 0) {
      item.entityTags.forEach((tag) => {
        const chip = document.createElement("span")
        chip.className = "od-chip"
        chip.textContent = tag
        chips.append(chip)
      })
    }
    const fields = row.querySelectorAll(".od-field p")
    ;(fields[0] as HTMLParagraphElement).textContent =
      item.entityArchiveIds?.join("、") || "无"
    ;(fields[1] as HTMLParagraphElement).textContent = item.content
    target.append(row)
  }
}

function renderArchives(target: HTMLDivElement, items: ArchiveRecord[]) {
  target.replaceChildren()
  if (items.length === 0) {
    target.append(empty("当前还没有档案。"))
    return
  }

  for (const item of items) {
    const row = document.createElement("article")
    row.className = "archive-item"
    row.innerHTML = `
      <div class="od-row">
        <h4>${item.name} · ${item.type}</h4>
        <p class="od-meta">${item.presence} · ${item.id}</p>
      </div>
      <div class="od-chips od-aliases"></div>
      <div class="od-field"><span>关联实体</span><div class="od-chips od-related"></div></div>
      <div class="od-field"><span>强绑定档案 ID</span><p></p></div>
      <div class="od-field"><span>背景</span><p></p></div>
      <div class="od-field"><span>现状</span><p></p></div>
      <div class="od-field"><span>关注点</span><p></p></div>
    `
    const chips = row.querySelector(".od-aliases") as HTMLDivElement
    if (item.aliases.length > 0) {
      item.aliases.forEach((alias) => {
        const chip = document.createElement("span")
        chip.className = "od-chip od-chip--soft"
        chip.textContent = alias
        chips.append(chip)
      })
    } else {
      const chip = document.createElement("span")
      chip.className = "od-chip od-chip--soft"
      chip.textContent = "无别称"
      chips.append(chip)
    }

    const related = row.querySelector(".od-related") as HTMLDivElement
    if (item.linkedNames.length > 0) {
      item.linkedNames.forEach((name) => {
        const chip = document.createElement("span")
        chip.className = "od-chip"
        chip.textContent = name
        related.append(chip)
      })
    } else {
      related.append(empty("当前没有稳定强关联实体。"))
    }

    const fields = row.querySelectorAll(".od-field p")
    ;(fields[0] as HTMLParagraphElement).textContent =
      item.linkedArchiveIds?.join("、") || "无"
    ;(fields[1] as HTMLParagraphElement).textContent = item.background || "无"
    ;(fields[2] as HTMLParagraphElement).textContent = item.situation || "无"
    ;(fields[3] as HTMLParagraphElement).textContent = item.focus || "该类型未提供关注点字段"
    target.append(row)
  }
}

function renderRetrieval(target: HTMLDivElement, items: RetrievalDebugRecord[]) {
  target.replaceChildren()
  const current = items[0]
  if (!current) {
    target.append(empty("这一轮还没有检索调试信息。"))
    return
  }

  const summary = document.createElement("article")
  summary.className = "od-card"
  summary.innerHTML = `
    <p class="od-k">本轮结构检索</p>
    <div class="od-field"><span>玩家输入</span><p></p></div>
    <div class="od-field"><span>直接命中实体</span><div class="od-chips od-direct"></div></div>
    <div class="od-field"><span>当前在场实体</span><div class="od-chips od-present"></div></div>
    <div class="od-field"><span>预设事件钩子</span><div class="od-chips od-catalog"></div></div>
    <div class="od-field"><span>桥接关联实体</span><div class="od-chips od-related"></div></div>
    <div class="od-field"><span>注入档案</span><div class="od-chips od-archives"></div></div>
    <div class="od-field"><span>AI 增强检索</span><p class="od-semantic"></p></div>
    <div class="od-field"><span>本轮参数</span><p class="od-settings"></p></div>
  `
  ;(summary.querySelector(".od-field p") as HTMLParagraphElement).textContent = current.input
  const direct = summary.querySelector(".od-direct") as HTMLDivElement
  if (current.directEntities.length > 0) {
    current.directEntities.forEach((name) => {
      const chip = document.createElement("span")
      chip.className = "od-chip"
      chip.textContent = name
      direct.append(chip)
    })
  } else {
    direct.append(empty("这一轮没有命中直接实体。"))
  }

  const present = summary.querySelector(".od-present") as HTMLDivElement
  if ((current.presentEntities ?? []).length > 0) {
    ;(current.presentEntities ?? []).forEach((name) => {
      const chip = document.createElement("span")
      chip.className = "od-chip"
      chip.textContent = name
      present.append(chip)
    })
  } else {
    present.append(empty("当前没有额外在场实体。"))
  }

  const catalog = summary.querySelector(".od-catalog") as HTMLDivElement
  if ((current.catalogEvents ?? []).length > 0) {
    ;(current.catalogEvents ?? []).forEach((item) => {
      const chip = document.createElement("span")
      chip.className = `od-chip${item.selected ? "" : " od-chip--soft"}`
      chip.textContent = `${item.name} · ${item.selected ? "已注入" : "候选"}`
      catalog.append(chip)
    })
  } else {
    catalog.append(empty("这一轮没有命中预设事件钩子。"))
  }

  const related = summary.querySelector(".od-related") as HTMLDivElement
  if (current.linkedEntities.length > 0) {
    current.linkedEntities.forEach((name) => {
      const chip = document.createElement("span")
      chip.className = "od-chip od-chip--soft"
      chip.textContent = name
      related.append(chip)
    })
  } else {
    related.append(empty("这一轮没有桥接关联实体。"))
  }

  const archives = summary.querySelector(".od-archives") as HTMLDivElement
  if (current.archives.length > 0) {
    current.archives.forEach((item) => {
      const chip = document.createElement("span")
      chip.className = "od-chip od-chip--soft"
      chip.textContent = `${item.name} · ${item.source ?? "hit"} · ${item.presence}`
      archives.append(chip)
    })
  } else {
    archives.append(empty("这一轮没有额外命中档案。"))
  }
  const semantic = summary.querySelector(".od-semantic") as HTMLParagraphElement
  if (!current.semantic?.enabled) {
    semantic.textContent = "未开启"
  } else if (current.semantic.error) {
    semantic.textContent = `开启，但失败：${current.semantic.error}`
  } else {
    semantic.textContent = [
      `关键词：${current.semantic.keywords.join("、") || "无"}`,
      `事件：${current.semantic.eventIds.join("、") || "无"}`,
      `档案：${current.semantic.archiveIds.join("、") || "无"}`,
    ].join("；")
  }
  const settings = summary.querySelector(".od-settings") as HTMLParagraphElement
  settings.textContent = current.settings
    ? Object.entries(current.settings)
        .map(([key, value]) => `${key}=${value}`)
        .join("；")
    : "未返回参数"
  target.append(summary)

  if ((current.catalogEvents ?? []).length > 0) {
    for (const item of current.catalogEvents ?? []) {
      const row = document.createElement("article")
      row.className = `retrieval-item${item.selected ? " is-selected" : ""}`
      row.innerHTML = `
        <div class="od-row">
          <h4>${item.selected ? "已注入预设钩子" : "候选预设钩子"}</h4>
          <p class="od-meta">score=${item.score.toFixed(3)}</p>
        </div>
        <div class="od-field"><span>名称</span><p></p></div>
        <div class="od-field"><span>剧情骨架</span><p></p></div>
        <div class="od-field"><span>作者备注</span><p></p></div>
      `
      const fields = row.querySelectorAll(".od-field p")
      ;(fields[0] as HTMLParagraphElement).textContent = item.name
      ;(fields[1] as HTMLParagraphElement).textContent = item.content
      ;(fields[2] as HTMLParagraphElement).textContent = item.guidance || "无"
      target.append(row)
    }
  }

  if (current.candidates.length === 0) {
    target.append(empty("当前没有候选事件。"))
    return
  }

  for (const item of current.candidates) {
    const row = document.createElement("article")
    row.className = `retrieval-item${item.selected ? " is-selected" : ""}`
    row.innerHTML = `
      <div class="od-row">
        <h4>${item.selected ? "已注入事件" : "候选事件"}</h4>
        <p class="od-meta">${item.status} · ${formatTime(item.time)}</p>
      </div>
      <div class="od-field"><span>评分</span><p></p></div>
      <div class="od-chips"></div>
      <div class="od-field"><span>事件正文</span><p></p></div>
    `
    const score = `final=${item.finalScore.toFixed(3)} / structure=${item.keywordScore.toFixed(
      3,
    )} / semantic=${item.semanticScore?.toFixed(3) ?? "n/a"}`
    const fields = row.querySelectorAll(".od-field p")
    ;(fields[0] as HTMLParagraphElement).textContent = score
    ;(fields[1] as HTMLParagraphElement).textContent = item.content
    const chips = row.querySelector(".od-chips") as HTMLDivElement
    item.tags.forEach((tag) => {
      const chip = document.createElement("span")
      chip.className = "od-chip"
      chip.textContent = tag
      chips.append(chip)
    })
    target.append(row)
  }
}

function renderAiDebug(target: HTMLDivElement, items: AiDebugRecord[]) {
  target.replaceChildren()
  if (items.length === 0) {
    target.append(empty("发送一轮消息后，这里会展示 AI 请求上下文和响应内容。"))
    return
  }

  for (const item of items) {
    const card = document.createElement("article")
    card.className = "od-card"
    const detail = document.createElement("div")
    detail.className = "od-field"
    detail.innerHTML = `
      <div class="od-row">
        <h4>${item.label} · ${item.kind}</h4>
        <p class="od-meta">${item.model}<br />${formatTime(item.createdAt)}</p>
      </div>
    `

    const sourceItems = item.messages ?? item.input?.map((content) => ({ role: "input", content })) ?? []
    sourceItems.forEach((message, index) => {
      const block = document.createElement("div")
      block.className = "ai-message"
      block.innerHTML = `<span class="ai-label">${index + 1}. ${ROLE_LABEL[message.role] ?? message.role}</span><p class="od-pre"></p>`
      ;(block.querySelector("p") as HTMLParagraphElement).textContent = message.content
      detail.append(block)
    })

    const response = document.createElement("div")
    response.className = "ai-message"
    const responseLabel = item.error
      ? "错误"
      : item.kind === "embedding"
        ? `向量响应：${item.vectorCount ?? 0} 条 / ${item.dimensions ?? 0} 维`
        : "AI 响应"
    response.innerHTML = `<span class="ai-label">${responseLabel}</span><p class="od-pre"></p>`
    ;(response.querySelector("p") as HTMLParagraphElement).textContent =
      item.error ?? item.responseText ?? "暂无响应内容。"
    detail.append(response)

    card.append(detail)
    target.append(card)
  }
}

export function mountOfficialDefaultFrontend(container: HTMLElement, bridge: PlayFrontendBridge): () => void {
  ensureStyles()

  const root = document.createElement("section")
  root.className = "official-default-frontend"
  root.innerHTML = `
    <header class="od-hero">
      <p class="od-eye">Official Default</p>
      <h2 class="od-title">叙事主界面</h2>
      <p class="od-summary">左侧只保留对话主线，右侧用单栏标签页承载事件、档案、检索和快照，避免测试时视线被大量调试信息打断。</p>
      <div class="od-mod-overview"></div>
      <div class="od-stats">
        <article class="od-stat"><span>Turn</span><strong data-stat="turn">0</strong></article>
        <article class="od-stat"><span>Messages</span><strong data-stat="messages">0</strong></article>
        <article class="od-stat"><span>Events</span><strong data-stat="events">0</strong></article>
        <article class="od-stat"><span>Archives</span><strong data-stat="archives">0</strong></article>
      </div>
      <div class="od-scene">
        <article class="od-scene-time">
          <span>叙事时间</span>
          <strong data-current-time>未设置</strong>
        </article>
        <div class="od-scene-status"></div>
      </div>
      <div class="od-demo" style="margin-top:16px;padding:14px 16px;border:1px solid rgba(148,163,184,.12);border-radius:16px;background:rgba(8,15,24,.46);display:grid;gap:10px">
        <p class="od-k" style="margin:0">桥写 API Demo (I5)</p>
        <p style="margin:0;color:#c6d3e2;font-size:13px;line-height:1.6">此 demo 验证桥 API updateGlobals → 下一轮工作流读 {{globals.demo.counter}}</p>
        <p style="margin:0;font-size:14px">demo.counter 当前值：<strong data-demo-counter style="color:var(--gold)">undefined</strong></p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="composer-button" data-demo-action="inc" type="button" style="min-width:80px">+1</button>
          <button class="composer-button" data-demo-action="reset" type="button" style="min-width:80px">重置</button>
        </div>
      </div>
    </header>
    <div class="od-layout">
      <section class="od-panel od-panel--play">
        <div class="od-head">
          <h3>对话主线</h3>
          <p>这里专注看玩家与叙事 AI 的往返，不把调试数据直接混进正文区域。</p>
        </div>
        <div class="od-history"></div>
        <form class="od-composer">
          <input class="composer-input" type="text" placeholder="输入一条真实游玩消息，继续推进剧情……" />
          <button class="composer-button" type="submit">发送</button>
        </form>
      </section>
      <aside class="od-panel od-panel--inspector">
        <div class="od-head">
          <h3>检查面板</h3>
          <p>按需切换事件、档案、检索和快照，不再一次展开全部数据。</p>
        </div>
        <div class="od-tabs">
          <button class="od-tab" data-tab="ai" type="button">AI</button>
          <button class="od-tab" data-tab="retrieval" type="button">检索</button>
          <button class="od-tab" data-tab="events" type="button">事件</button>
          <button class="od-tab" data-tab="archives" type="button">档案</button>
          <button class="od-tab" data-tab="checkpoints" type="button">回溯</button>
          <button class="od-tab" data-tab="snapshot" type="button">快照</button>
          <button class="od-tab" data-tab="workflow" type="button">工作流</button>
        </div>
        <div class="od-tabpanes">
          <div class="od-pane" data-pane="ai"></div>
          <div class="od-pane" data-pane="retrieval"></div>
          <div class="od-pane" data-pane="events"></div>
          <div class="od-pane" data-pane="archives"></div>
          <div class="od-pane" data-pane="checkpoints"></div>
          <div class="od-pane" data-pane="snapshot"></div>
          <div class="od-pane" data-pane="workflow"></div>
        </div>
      </aside>
    </div>
  `
  container.replaceChildren(root)

  const history = root.querySelector(".od-history") as HTMLDivElement
  const form = root.querySelector(".od-composer") as HTMLFormElement
  const input = root.querySelector(".composer-input") as HTMLInputElement
  const button = root.querySelector(".composer-button") as HTMLButtonElement
  const statTurn = root.querySelector('[data-stat="turn"]') as HTMLElement
  const statMessages = root.querySelector('[data-stat="messages"]') as HTMLElement
  const statEvents = root.querySelector('[data-stat="events"]') as HTMLElement
  const statArchives = root.querySelector('[data-stat="archives"]') as HTMLElement
  const sceneTime = root.querySelector("[data-current-time]") as HTMLElement
  const sceneStatus = root.querySelector(".od-scene-status") as HTMLDivElement
  const demoCounter = root.querySelector("[data-demo-counter]") as HTMLElement
  const demoIncBtn = root.querySelector('[data-demo-action="inc"]') as HTMLButtonElement
  const demoResetBtn = root.querySelector('[data-demo-action="reset"]') as HTMLButtonElement
  const modOverview = root.querySelector(".od-mod-overview") as HTMLDivElement
  const aiDebugPane = root.querySelector('[data-pane="ai"]') as HTMLDivElement
  const retrievalPane = root.querySelector('[data-pane="retrieval"]') as HTMLDivElement
  const eventsPane = root.querySelector('[data-pane="events"]') as HTMLDivElement
  const archivesPane = root.querySelector('[data-pane="archives"]') as HTMLDivElement
  const checkpointsPane = root.querySelector('[data-pane="checkpoints"]') as HTMLDivElement
  const snapshotPane = root.querySelector('[data-pane="snapshot"]') as HTMLDivElement
  const workflowPane = root.querySelector('[data-pane="workflow"]') as HTMLDivElement
  const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>(".od-tab"))
  const panes: Array<{ name: InspectorTab; pane: HTMLDivElement }> = [
    { name: "ai", pane: aiDebugPane },
    { name: "retrieval", pane: retrievalPane },
    { name: "events", pane: eventsPane },
    { name: "archives", pane: archivesPane },
    { name: "checkpoints", pane: checkpointsPane },
    { name: "snapshot", pane: snapshotPane },
    { name: "workflow", pane: workflowPane },
  ]

  let activeTab: InspectorTab = "ai"

  const syncTabs = () => {
    tabs.forEach((tab) => {
      const current = tab.dataset.tab as InspectorTab
      tab.classList.toggle("is-active", current === activeTab)
    })
    panes.forEach(({ name, pane }) => {
      pane.classList.toggle("is-active", name === activeTab)
    })
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      activeTab = tab.dataset.tab as InspectorTab
      syncTabs()
    })
  })
  syncTabs()

  const refresh = async () => {
    const snapshot = await bridge.runtime.getRuntimeSnapshot()
    const historyResult = await bridge.query.query<ConversationMessageRecord>({ resource: "history" })
    const eventResult = await bridge.query.query<EventRecord>({ resource: "events" })
    const archiveResult = await bridge.query.query<ArchiveRecord>({ resource: "archives" })
    const modResult = await bridge.query.query<ModStaticContent>({ resource: "mod-static" })
    const aiDebugResult = await bridge.query.query<AiDebugRecord>({ resource: "ai-debug" })
    const retrievalResult = await bridge.query.query<RetrievalDebugRecord>({
      resource: "retrieval-debug",
    })
    const checkpointResult = await bridge.query.query<CheckpointSummary>({
      resource: "checkpoints",
    })
    // H11：工作流执行轨迹（WorkflowOutputsSnapshot）
    const workflowDebugResult = await bridge.query.query<unknown>({
      resource: "workflow-debug",
    })

    statTurn.textContent = String(turn(snapshot))
    statMessages.textContent = String(historyResult.items.length)
    statEvents.textContent = String(eventResult.items.length)
    statArchives.textContent = String(archiveResult.items.length)

    // I5 demo：从 snapshot.state.globals.demo.counter 读当前值
    const rawGlobals = snapshot.state.globals
    let demoCounterValue: unknown = undefined
    if (typeof rawGlobals === "object" && rawGlobals !== null && !Array.isArray(rawGlobals)) {
      const demoBucket = (rawGlobals as Record<string, unknown>).demo
      if (typeof demoBucket === "object" && demoBucket !== null && !Array.isArray(demoBucket)) {
        demoCounterValue = (demoBucket as Record<string, unknown>).counter
      }
    }
    demoCounter.textContent =
      demoCounterValue === undefined ? "undefined" : formatGlobalValue(demoCounterValue)

    renderModOverview(modOverview, modResult.items[0] ?? null)
    renderSceneStatus(sceneTime, sceneStatus, snapshot)
    renderHistory(history, historyResult.items)
    renderAiDebug(aiDebugPane, aiDebugResult.items)
    renderEvents(eventsPane, eventResult.items)
    renderArchives(archivesPane, archiveResult.items)
    renderCheckpoints(checkpointsPane, checkpointResult.items, async (checkpointId) => {
      const result = await bridge.platform.runAction({
        action: "restore-checkpoint",
        params: { checkpointId },
      })
      if (!result.ok) {
        window.alert(result.error?.message ?? "恢复 checkpoint 失败。")
        return
      }
      await refresh()
      history.scrollTo({ top: history.scrollHeight })
    })
    renderRetrieval(retrievalPane, retrievalResult.items)
    renderSnapshot(snapshotPane, snapshot)

    // H11：工作流执行轨迹面板，直接 JSON.stringify 展示
    workflowPane.replaceChildren()
    const wfCard = document.createElement("article")
    wfCard.className = "od-card"
    // workflow-debug 资源返回 { data: WorkflowOutputsSnapshot | null } 而非 items
    const wfRaw = (workflowDebugResult as unknown as { data: unknown }).data
    const wfDetails = document.createElement("details")
    wfDetails.open = true
    const wfSummary = document.createElement("summary")
    wfSummary.textContent = "工作流执行轨迹"
    const wfPre = document.createElement("pre")
    wfPre.className = "od-pre"
    wfPre.textContent = wfRaw ? JSON.stringify(wfRaw, null, 2) : "这一轮还没有工作流执行轨迹。"
    wfDetails.append(wfSummary, wfPre)
    wfCard.append(wfDetails)
    workflowPane.append(wfCard)
  }

  const onSubmit = async (event: SubmitEvent) => {
    event.preventDefault()
    const content = input.value.trim()
    if (!content) {
      return
    }

    button.disabled = true
    button.textContent = "发送中…"

    try {
      const snapshot = await bridge.runtime.getRuntimeSnapshot()
      const rawTime = currentTime(snapshot)
      await bridge.interaction.sendMessage({
        content,
        narrativeTimeText: rawTime ? formatTime(rawTime) : undefined,
      })
      input.value = ""
      await refresh()
      history.scrollTo({ top: history.scrollHeight, behavior: "smooth" })
    } finally {
      button.disabled = false
      button.textContent = "发送"
    }
  }

  const readDemoCounter = async (): Promise<number> => {
    const snapshot = await bridge.runtime.getRuntimeSnapshot()
    const rawGlobals = snapshot.state.globals
    if (typeof rawGlobals === "object" && rawGlobals !== null && !Array.isArray(rawGlobals)) {
      const demoBucket = (rawGlobals as Record<string, unknown>).demo
      if (typeof demoBucket === "object" && demoBucket !== null && !Array.isArray(demoBucket)) {
        const value = (demoBucket as Record<string, unknown>).counter
        if (typeof value === "number") {
          return value
        }
      }
    }
    return 0
  }

  const onDemoInc = async () => {
    demoIncBtn.disabled = true
    try {
      const current = await readDemoCounter()
      await bridge.runtime.updateGlobals("demo.counter", current + 1)
      await refresh()
    } catch (error) {
      window.alert(`demo +1 失败：${error instanceof Error ? error.message : String(error)}`)
      throw error
    } finally {
      demoIncBtn.disabled = false
    }
  }

  const onDemoReset = async () => {
    demoResetBtn.disabled = true
    try {
      await bridge.runtime.updateGlobals("demo.counter", 0)
      await refresh()
    } catch (error) {
      window.alert(`demo 重置失败：${error instanceof Error ? error.message : String(error)}`)
      throw error
    } finally {
      demoResetBtn.disabled = false
    }
  }

  demoIncBtn.addEventListener("click", onDemoInc)
  demoResetBtn.addEventListener("click", onDemoReset)
  form.addEventListener("submit", onSubmit)
  void refresh().then(() => history.scrollTo({ top: history.scrollHeight }))

  return () => {
    demoIncBtn.removeEventListener("click", onDemoInc)
    demoResetBtn.removeEventListener("click", onDemoReset)
    form.removeEventListener("submit", onSubmit)
    container.replaceChildren()
  }
}
