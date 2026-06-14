import type {
  AiDebugRecord,
  CheckpointSummary,
  ConversationMessageRecord,
  PlayFrontendBridge,
  PlayFrontendManifest,
  RuntimeSnapshotShell,
} from "@tsian/contracts"

type InspectorTab = "ai" | "checkpoints" | "snapshot"

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
    .official-default-frontend{--bg:rgba(9,15,24,.82);--bg2:rgba(7,12,20,.95);--line:rgba(148,163,184,.16);--text:#e6edf8;--muted:#8ea2bb;--gold:#f6b94f;min-height:100dvh;display:grid;gap:18px;padding:18px;color:var(--text);font-family:"Source Han Sans SC","Noto Sans SC","Microsoft YaHei",sans-serif;background:radial-gradient(circle at 15% 0%,rgba(246,185,79,.16),transparent 32%),linear-gradient(135deg,#08111d,#111827 48%,#07111b)}
    .official-default-frontend *{box-sizing:border-box;min-width:0}
    .od-hero,.od-panel{border:1px solid var(--line);border-radius:8px;background:linear-gradient(180deg,rgba(12,19,31,.96),rgba(7,11,18,.96));box-shadow:0 22px 48px rgba(2,6,23,.18)}
    .od-hero{display:grid;gap:14px;padding:18px 20px}
    .od-eye{margin:0;color:var(--gold);font-size:11px;letter-spacing:.24em;text-transform:uppercase}
    .od-title{margin:0;font-family:"Iowan Old Style","Noto Serif SC","Source Han Serif SC",serif;font-size:clamp(28px,4vw,40px);line-height:1.08}
    .od-summary{margin:0;color:#c6d3e2;font-size:14px;line-height:1.75}
    .od-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
    .od-stat{padding:12px 14px;border:1px solid rgba(148,163,184,.12);border-radius:8px;background:rgba(8,15,24,.46)}
    .od-stat span{display:block;color:var(--muted);font-size:11px;letter-spacing:.12em;text-transform:uppercase}
    .od-stat strong{display:block;margin-top:8px;font-size:15px}
    .od-layout{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(320px,.95fr);gap:18px;align-items:start}
    .od-panel{display:flex;flex-direction:column;min-height:0;overflow:hidden}
    .od-panel--play,.od-panel--inspector{height:min(820px,calc(100dvh - 180px))}
    .od-head{padding:16px 18px;border-bottom:1px solid var(--line)}
    .od-head h3{margin:0;font-family:"Iowan Old Style","Noto Serif SC","Source Han Serif SC",serif;font-size:23px}
    .od-head p{margin:8px 0 0;color:var(--muted);font-size:13px;line-height:1.6}
    .od-history{flex:1;min-height:280px;overflow:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:14px;padding:18px;background:linear-gradient(180deg,rgba(8,15,24,.18),rgba(8,15,24,.08));scrollbar-color:rgba(246,185,79,.38) rgba(8,15,24,.64)}
    .history-item{max-width:88%;padding:14px 16px;border:1px solid rgba(148,163,184,.12);border-radius:8px;background:var(--bg)}
    .history-item--user{align-self:flex-end;background:linear-gradient(180deg,rgba(246,185,79,.16),rgba(246,185,79,.06)),rgba(12,18,28,.98);border-color:rgba(246,185,79,.18)}
    .history-item--assistant{align-self:flex-start;background:linear-gradient(180deg,rgba(117,184,255,.12),rgba(117,184,255,.04)),rgba(10,16,26,.98)}
    .history-item--system{align-self:center;max-width:100%;border-style:dashed}
    .od-role{display:block;margin-bottom:10px;color:var(--gold);font-size:11px;letter-spacing:.16em;text-transform:uppercase}
    .od-body{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:15px;line-height:1.8}
    .od-composer{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;padding:16px 18px 18px;border-top:1px solid var(--line);background:var(--bg2)}
    .composer-input{width:100%;min-height:56px;padding:14px 16px;border:1px solid rgba(148,163,184,.16);border-radius:8px;background:rgba(10,17,28,.94);color:var(--text);font:inherit}
    .composer-input:focus{outline:none;border-color:rgba(246,185,79,.42);box-shadow:0 0 0 4px rgba(246,185,79,.08)}
    .composer-button{min-width:112px;padding:0 18px;border:1px solid rgba(246,185,79,.24);border-radius:8px;background:linear-gradient(180deg,rgba(246,185,79,.22),rgba(246,185,79,.08)),rgba(15,22,34,.96);color:#fff7ea;font:inherit;font-weight:600;cursor:pointer}
    .composer-button:disabled{cursor:not-allowed;opacity:.55}
    .od-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;padding:14px 16px 0;background:rgba(255,255,255,.02)}
    .od-tab{padding:11px 10px;border:1px solid rgba(148,163,184,.12);border-radius:8px 8px 0 0;background:rgba(8,15,24,.56);color:var(--muted);font:inherit;font-size:13px;cursor:pointer}
    .od-tab.is-active{color:var(--text);border-color:rgba(246,185,79,.2);background:linear-gradient(180deg,rgba(246,185,79,.12),rgba(246,185,79,0)),rgba(10,16,26,.96)}
    .od-tabpanes{flex:1;min-height:0;overflow:hidden;background:rgba(7,12,20,.72)}
    .od-pane{display:none;height:100%;overflow:auto;padding:16px;overscroll-behavior:contain}
    .od-pane.is-active{display:grid;align-content:start;gap:14px}
    .od-card{padding:14px;border:1px solid var(--line);border-radius:8px;background:var(--bg)}
    .od-k{margin:0 0 10px;color:var(--muted);font-size:12px;letter-spacing:.08em;text-transform:uppercase}
    .od-pre,.od-field p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;line-height:1.7}
    .od-field{display:grid;gap:6px}
    .od-field span{color:var(--muted);font-size:12px;letter-spacing:.06em;text-transform:uppercase}
    .od-row{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
    .od-row h4{margin:0;font-size:15px}
    .od-meta{margin:0;color:var(--muted);font-size:12px;text-align:right;line-height:1.6}
    .ai-message{display:grid;gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid rgba(148,163,184,.1)}
    .ai-label{display:inline-flex;width:max-content;padding:4px 8px;border-radius:999px;background:rgba(117,184,255,.12);color:#b0d6ff;font-size:12px}
    .od-empty{margin:0;padding:14px;border:1px dashed var(--line);border-radius:8px;color:var(--muted);background:rgba(8,15,24,.3);font-size:13px}
    @media (max-width:1080px){.od-layout{grid-template-columns:1fr}.od-panel--play,.od-panel--inspector{height:auto;max-height:none}.od-history{max-height:58vh}}
    @media (max-width:720px){.official-default-frontend{padding:12px}.od-stats,.od-tabs,.od-composer{grid-template-columns:1fr}.history-item{max-width:100%}.od-hero,.od-head{padding:16px}}
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
  return typeof snapshot.state.turn === "number" ? snapshot.state.turn : 0
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function formatTime(value: number | string): string {
  const date = typeof value === "number" ? new Date(value) : new Date(value)
  if (Number.isNaN(date.getTime())) {
    return String(value)
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
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

function renderSnapshot(target: HTMLDivElement, snapshot: RuntimeSnapshotShell) {
  target.replaceChildren()
  const card = document.createElement("article")
  card.className = "od-card"
  card.innerHTML = `<p class="od-k">Runtime Snapshot</p><pre class="od-pre"></pre>`
  ;(card.querySelector("pre") as HTMLPreElement).textContent = formatJson(snapshot)
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
      <button class="composer-button checkpoint-restore" type="button">恢复</button>
    `
    ;(card.querySelector("h4") as HTMLHeadingElement).textContent = item.label
    ;(card.querySelector(".od-meta") as HTMLParagraphElement).textContent =
      `${formatTime(item.createdAt)} · ${item.reason}`
    ;(card.querySelector(".od-field p") as HTMLParagraphElement).textContent =
      `回合 ${item.turn} · ${item.messageCount} 条对话 · ${item.workspaceFileCount} 个工作区文件`
    ;(card.querySelector("button") as HTMLButtonElement).addEventListener("click", () => {
      onRestore(item.id)
    })
    target.append(card)
  }
}

function renderAiDebug(target: HTMLDivElement, items: AiDebugRecord[]) {
  target.replaceChildren()
  if (items.length === 0) {
    target.append(empty("发送一轮消息后，这里会展示 master-agent 与 narrative-agent 的请求和响应。"))
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

    ;(item.messages ?? []).forEach((message, index) => {
      const block = document.createElement("div")
      block.className = "ai-message"
      block.innerHTML = `<span class="ai-label">${index + 1}. ${ROLE_LABEL[message.role] ?? message.role}</span><p class="od-pre"></p>`
      ;(block.querySelector("p") as HTMLParagraphElement).textContent = message.content
      detail.append(block)
    })

    const response = document.createElement("div")
    response.className = "ai-message"
    const responseLabel = item.error ? "错误" : "AI 响应"
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
      <p class="od-summary">当前默认前端只负责呈现会话数据。玩家输入会交给平台侧 Agent Runtime 编排，再把正文写回对话主线。</p>
      <div class="od-stats">
        <article class="od-stat"><span>Turn</span><strong data-stat="turn">0</strong></article>
        <article class="od-stat"><span>Messages</span><strong data-stat="messages">0</strong></article>
        <article class="od-stat"><span>Checkpoints</span><strong data-stat="checkpoints">0</strong></article>
      </div>
    </header>
    <div class="od-layout">
      <section class="od-panel od-panel--play">
        <div class="od-head">
          <h3>对话主线</h3>
          <p>剧情正文会直接出现在这里。</p>
        </div>
        <div class="od-history"></div>
        <form class="od-composer">
          <input class="composer-input" type="text" placeholder="输入玩家行动或对话……" />
          <button class="composer-button" type="submit">发送</button>
        </form>
      </section>
      <aside class="od-panel od-panel--inspector">
        <div class="od-head">
          <h3>检查面板</h3>
          <p>查看本轮 Agent 调用、回溯点和运行时数据。</p>
        </div>
        <div class="od-tabs">
          <button class="od-tab" data-tab="ai" type="button">AI</button>
          <button class="od-tab" data-tab="checkpoints" type="button">回溯</button>
          <button class="od-tab" data-tab="snapshot" type="button">快照</button>
        </div>
        <div class="od-tabpanes">
          <div class="od-pane" data-pane="ai"></div>
          <div class="od-pane" data-pane="checkpoints"></div>
          <div class="od-pane" data-pane="snapshot"></div>
        </div>
      </aside>
    </div>
  `
  container.replaceChildren(root)

  const history = root.querySelector(".od-history") as HTMLDivElement
  const form = root.querySelector(".od-composer") as HTMLFormElement
  const input = form.querySelector(".composer-input") as HTMLInputElement
  const button = form.querySelector('button[type="submit"]') as HTMLButtonElement
  const statTurn = root.querySelector('[data-stat="turn"]') as HTMLElement
  const statMessages = root.querySelector('[data-stat="messages"]') as HTMLElement
  const statCheckpoints = root.querySelector('[data-stat="checkpoints"]') as HTMLElement
  const aiDebugPane = root.querySelector('[data-pane="ai"]') as HTMLDivElement
  const checkpointsPane = root.querySelector('[data-pane="checkpoints"]') as HTMLDivElement
  const snapshotPane = root.querySelector('[data-pane="snapshot"]') as HTMLDivElement
  const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>(".od-tab"))
  const panes: Array<{ name: InspectorTab; pane: HTMLDivElement }> = [
    { name: "ai", pane: aiDebugPane },
    { name: "checkpoints", pane: checkpointsPane },
    { name: "snapshot", pane: snapshotPane },
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
    const aiDebugResult = await bridge.query.query<AiDebugRecord>({ resource: "ai-debug" })
    const checkpointResult = await bridge.query.query<CheckpointSummary>({
      resource: "checkpoints",
    })

    statTurn.textContent = String(turn(snapshot))
    statMessages.textContent = String(historyResult.items.length)
    statCheckpoints.textContent = String(checkpointResult.items.length)

    renderHistory(history, historyResult.items)
    renderAiDebug(aiDebugPane, aiDebugResult.items)
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
    renderSnapshot(snapshotPane, snapshot)
  }

  const onSubmit = async (event: SubmitEvent) => {
    event.preventDefault()
    const content = input.value.trim()
    if (!content) {
      return
    }

    button.disabled = true
    button.textContent = "发送中..."

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

  const unsubscribeTurnReady = bridge.debug?.onTurnDebugReady(() => {
    void refresh()
  })

  form.addEventListener("submit", onSubmit)
  void refresh().then(() => history.scrollTo({ top: history.scrollHeight }))

  return () => {
    unsubscribeTurnReady?.()
    form.removeEventListener("submit", onSubmit)
    container.replaceChildren()
  }
}
