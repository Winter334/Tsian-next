import type { GameCardFrontendBinding } from "@tsian/contracts"
import type { PutLocalGameCardFrontendFileInput } from "./game-cards"

/** Generic authoring placeholder; the official reader frontend ships in its own card package. */
export const DEFAULT_FRONTEND_BINDING: GameCardFrontendBinding = {
  kind: "packaged",
  entry: "frontend/dist/index.html",
  framework: "vanilla",
  bridgeVersion: "tsian.play-bridge.v1",
}

// ════════════════════════════════════════════════════════════════
// frontend/src/main.ts — placeholder source (vanilla TS, no deps)
// ════════════════════════════════════════════════════════════════
// Minimal: render a "card loaded" shell + a basic play-bridge handshake so
// /play recognizes the frontend as mounted. No AIRP rendering — that lands
// with the real frontend migration (R7 follow-up). The platform build engine
// compiles this TS into frontend/dist/; the Service Worker loads dist/.

const FRONTEND_SRC_MAIN_TS = [
  "// Tsian default card — placeholder frontend (vanilla).",
  "// Official cards provide their own frontend. This placeholder only",
  "// validates the platform build chain (source -> build -> SW load).",
  "",
  'const CHANNEL = "tsian.play-bridge.v1";',
  "",
  "// Minimal bridge handshake so /play sees the frontend as ready.",
  'window.parent.postMessage({ channel: CHANNEL, kind: "hello" }, "*");',
  "",
  'window.addEventListener("message", (e) => {',
  '  const msg = e.data;',
  '  if (!msg || msg.channel !== CHANNEL) return;',
  '  if (msg.kind === "ready") {',
  '    document.body.setAttribute("data-bridge", "ready");',
  "  }",
  "});",
  "",
  "// Placeholder shell.",
  'document.body.innerHTML = `',
  '  <div style="font-family: system-ui, sans-serif; color: #d4a24c; background: #14110d; height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 24px; text-align: center;">',
  "    <h1 style=\"margin:0; font-size: 20px; letter-spacing: 0.08em;\">Tsian</h1>",
  "    <p style=\"margin:0; color: #a89a7e; font-size: 14px;\">游戏卡前端已加载（占位）</p>",
  "    <p style=\"margin:0; color: #6f6553; font-size: 12px;\">请在工作室配置游戏卡的前端与内容</p>",
  "  </div>",
  "`;",
  "",
].join("\n")

/**
 * The default card's frontend source files, ready to inject via
 * `putLocalGameCard`'s `frontendFiles`. These are SOURCE files under
 * `frontend/src/`; the platform build engine compiles them into
 * `frontend/dist/` on first load (or via the rebuild trigger).
 */
export function defaultFrontendFiles(): PutLocalGameCardFrontendFileInput[] {
  return [
    { path: "frontend/src/main.ts", data: FRONTEND_SRC_MAIN_TS },
  ]
}
