import type { GameCardFrontendBinding } from "@tsian/contracts"
import type { PutLocalGameCardFrontendFileInput } from "./game-cards"

/**
 * Packaged frontend binding for the default lightweight frontend.
 *
 * Phase 5 (task 06-30): the default card switched from the legacy inline
 * native-JS triple (index.html + style.css + app.js + vendor/marked) to a
 * **source-form vanilla placeholder** that flows through the platform build
 * engine. This validates the full "source → platform build → SW load" chain
 * on the built-in card without depending on `@tsian/play-bridge` (an internal
 * package not yet published, which the esm.sh CDN cannot resolve).
 *
 * R7 split: this placeholder is the transitional default. The real frontend
 * migration (play-frontend-dev/src TS+bridge as the seed, Vue framework) is a
 * follow-up task that depends on (a) platform build engine support for
 * resolving internal `@tsian/*` packages without npm publish, and (b) the
 * planned play-frontend-dev refactor. See prd.md R7 / design.md §9 notes.
 *
 * The placeholder renders a simple "card loaded" shell with a minimal bridge
 * handshake so /play can mount it; it is NOT a full AIRP reader.
 */
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
  "// Transitional: the real AIRP frontend (TS + @tsian/play-bridge) lands in",
  "// a follow-up task after play-frontend-dev refactor. This placeholder only",
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
  "    <p style=\"margin:0; color: #6f6553; font-size: 12px;\">正式前端待 play-frontend-dev 重构后接入</p>",
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
