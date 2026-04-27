import type {
  ArchiveRecord,
  ConversationMessageRecord,
  EventRecord,
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
}

interface RetrievalDebugRecord {
  input: string
  directEntities: string[]
  linkedEntities: string[]
  groups: string[][]
  candidates: RetrievalCandidateDebugRecord[]
  archives: RetrievalArchiveDebugRecord[]
}

type InspectorTab = "retrieval" | "events" | "archives" | "snapshot"

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
    .od-panel--inspector{height:min(960px,calc(100vh - 32px))}
    .od-head{padding:18px 20px;border-bottom:1px solid var(--line)}
    .od-head h3{margin:0;font-family:"Iowan Old Style","Noto Serif SC","Source Han Serif SC",serif;font-size:24px}
    .od-head p{margin:8px 0 0;color:var(--muted);font-size:13px;line-height:1.6}
    .od-history{flex:1;overflow:auto;display:flex;flex-direction:column;gap:14px;padding:20px;background:linear-gradient(180deg,rgba(8,15,24,.18),rgba(8,15,24,.08))}
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
    .od-tabs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;padding:14px 16px 0;background:rgba(255,255,255,.02)}
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
    .od-chips{display:flex;flex-wrap:wrap;gap:8px}
    .od-chip{display:inline-flex;align-items:center;padding:6px 10px;border-radius:999px;background:rgba(246,185,79,.12);color:#f1d7a1;font-size:12px}
    .od-chip--soft{background:rgba(117,184,255,.12);color:#b0d6ff}
    .od-empty{margin:0;padding:16px;border:1px dashed var(--line);border-radius:18px;color:var(--muted);background:rgba(8,15,24,.3);font-size:13px}
    @media (max-width:1080px){.od-layout{grid-template-columns:1fr}.od-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.od-scene{grid-template-columns:1fr}.od-panel--inspector{height:auto;max-height:none}}
    @media (max-width:720px){.od-stats,.od-tabs,.od-composer{grid-template-columns:1fr}.history-item{max-width:100%}.od-hero,.od-head{padding:18px}}
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

  return value.replace("T", " ").replace(/\.\d+Z?$/, "").replace("Z", "")
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
      <div class="od-field"><span>正文</span><p></p></div>
    `
    ;(row.querySelector(".od-meta") as HTMLParagraphElement).textContent = item.time
    const chips = row.querySelector(".od-chips") as HTMLDivElement
    if (item.entityTags.length > 0) {
      item.entityTags.forEach((tag) => {
        const chip = document.createElement("span")
        chip.className = "od-chip"
        chip.textContent = tag
        chips.append(chip)
      })
    }
    ;(row.querySelector(".od-field p") as HTMLParagraphElement).textContent = item.content
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
        <h4>${item.name} · ${item.kind}</h4>
        <p class="od-meta">${item.presence} · ${item.id}</p>
      </div>
      <div class="od-chips od-aliases"></div>
      <div class="od-field"><span>关联实体</span><div class="od-chips od-related"></div></div>
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
    ;(fields[0] as HTMLParagraphElement).textContent = item.background || "无"
    ;(fields[1] as HTMLParagraphElement).textContent = item.situation || "无"
    ;(fields[2] as HTMLParagraphElement).textContent = item.focus || "无"
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
    <p class="od-k">本轮检索规划</p>
    <div class="od-field"><span>玩家输入</span><p></p></div>
    <div class="od-field"><span>直接命中实体</span><div class="od-chips od-direct"></div></div>
    <div class="od-field"><span>高频关联实体</span><div class="od-chips od-related"></div></div>
    <div class="od-field"><span>查询词组</span><div class="od-chips od-groups"></div></div>
    <div class="od-field"><span>命中的档案</span><div class="od-chips od-archives"></div></div>
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

  const related = summary.querySelector(".od-related") as HTMLDivElement
  if (current.linkedEntities.length > 0) {
    current.linkedEntities.forEach((name) => {
      const chip = document.createElement("span")
      chip.className = "od-chip od-chip--soft"
      chip.textContent = name
      related.append(chip)
    })
  } else {
    related.append(empty("这一轮没有额外高频关联实体。"))
  }

  const groups = summary.querySelector(".od-groups") as HTMLDivElement
  if (current.groups.length > 0) {
    current.groups.forEach((group) => {
      const chip = document.createElement("span")
      chip.className = "od-chip"
      chip.textContent = group.join(" · ")
      groups.append(chip)
    })
  } else {
    groups.append(empty("这一轮没有额外查询词组。"))
  }

  const archives = summary.querySelector(".od-archives") as HTMLDivElement
  if (current.archives.length > 0) {
    current.archives.forEach((item) => {
      const chip = document.createElement("span")
      chip.className = "od-chip od-chip--soft"
      chip.textContent = `${item.name} · ${item.presence} · ${item.score.toFixed(2)}`
      archives.append(chip)
    })
  } else {
    archives.append(empty("这一轮没有额外命中档案。"))
  }
  target.append(summary)

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
        <p class="od-meta">${item.status} · ${item.time}</p>
      </div>
      <div class="od-field"><span>评分</span><p></p></div>
      <div class="od-chips"></div>
      <div class="od-field"><span>事件正文</span><p></p></div>
    `
    const score = `final=${item.finalScore.toFixed(3)} / keyword=${item.keywordScore.toFixed(
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

export function mountOfficialDefaultFrontend(container: HTMLElement, bridge: PlayFrontendBridge): () => void {
  ensureStyles()

  const root = document.createElement("section")
  root.className = "official-default-frontend"
  root.innerHTML = `
    <header class="od-hero">
      <p class="od-eye">Official Default</p>
      <h2 class="od-title">叙事主界面</h2>
      <p class="od-summary">左侧只保留对话主线，右侧用单栏标签页承载事件、档案、检索和快照，避免测试时视线被大量调试信息打断。</p>
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
    </header>
    <div class="od-layout">
      <section class="od-panel">
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
          <button class="od-tab" data-tab="retrieval" type="button">检索</button>
          <button class="od-tab" data-tab="events" type="button">事件</button>
          <button class="od-tab" data-tab="archives" type="button">档案</button>
          <button class="od-tab" data-tab="snapshot" type="button">快照</button>
        </div>
        <div class="od-tabpanes">
          <div class="od-pane" data-pane="retrieval"></div>
          <div class="od-pane" data-pane="events"></div>
          <div class="od-pane" data-pane="archives"></div>
          <div class="od-pane" data-pane="snapshot"></div>
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
  const retrievalPane = root.querySelector('[data-pane="retrieval"]') as HTMLDivElement
  const eventsPane = root.querySelector('[data-pane="events"]') as HTMLDivElement
  const archivesPane = root.querySelector('[data-pane="archives"]') as HTMLDivElement
  const snapshotPane = root.querySelector('[data-pane="snapshot"]') as HTMLDivElement
  const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>(".od-tab"))
  const panes: Array<{ name: InspectorTab; pane: HTMLDivElement }> = [
    { name: "retrieval", pane: retrievalPane },
    { name: "events", pane: eventsPane },
    { name: "archives", pane: archivesPane },
    { name: "snapshot", pane: snapshotPane },
  ]

  let activeTab: InspectorTab = "retrieval"

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
    const retrievalResult = await bridge.query.query<RetrievalDebugRecord>({
      resource: "retrieval-debug",
    })

    statTurn.textContent = String(turn(snapshot))
    statMessages.textContent = String(historyResult.items.length)
    statEvents.textContent = String(eventResult.items.length)
    statArchives.textContent = String(archiveResult.items.length)

    renderSceneStatus(sceneTime, sceneStatus, snapshot)
    renderHistory(history, historyResult.items)
    renderEvents(eventsPane, eventResult.items)
    renderArchives(archivesPane, archiveResult.items)
    renderRetrieval(retrievalPane, retrievalResult.items)
    renderSnapshot(snapshotPane, snapshot)
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
      await bridge.interaction.sendMessage({ content })
      input.value = ""
      await refresh()
      history.scrollTo({ top: history.scrollHeight, behavior: "smooth" })
    } finally {
      button.disabled = false
      button.textContent = "发送"
    }
  }

  form.addEventListener("submit", onSubmit)
  void refresh().then(() => history.scrollTo({ top: history.scrollHeight }))

  return () => {
    form.removeEventListener("submit", onSubmit)
    container.replaceChildren()
  }
}
