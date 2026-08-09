import { spawn, spawnSync } from "node:child_process"
import { createServer } from "node:http"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { extname, join, resolve, sep } from "node:path"
import process from "node:process"

function fail(message) {
  throw new Error(message)
}

function commandAvailable(command) {
  const probe = spawnSync(command, ["--version"], {
    stdio: "ignore",
    windowsHide: true,
  })
  return probe.status === 0
}

function browserCandidates() {
  if (process.env.TSIAN_BROWSER_PATH) return [process.env.TSIAN_BROWSER_PATH]
  if (process.platform === "win32") {
    return [
      join(process.env.PROGRAMFILES ?? "", "Google", "Chrome", "Application", "chrome.exe"),
      join(process.env["PROGRAMFILES(X86)"] ?? "", "Google", "Chrome", "Application", "chrome.exe"),
      join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe"),
      join(process.env.PROGRAMFILES ?? "", "Microsoft", "Edge", "Application", "msedge.exe"),
      join(process.env["PROGRAMFILES(X86)"] ?? "", "Microsoft", "Edge", "Application", "msedge.exe"),
    ]
  }
  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ]
  }
  return ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"]
}

export async function findHeadlessBrowser() {
  for (const candidate of browserCandidates()) {
    if (!candidate) continue
    if (candidate.includes(sep)) {
      try {
        if ((await stat(candidate)).isFile()) return candidate
      } catch {}
    } else if (commandAvailable(candidate)) {
      return candidate
    }
  }
  fail("Chrome, Edge, or Chromium was not found. Set TSIAN_BROWSER_PATH to the browser executable.")
}

function contentType(pathname) {
  switch (extname(pathname)) {
    case ".html": return "text/html; charset=utf-8"
    case ".js": return "text/javascript; charset=utf-8"
    case ".css": return "text/css; charset=utf-8"
    case ".json": return "application/json; charset=utf-8"
    case ".wasm": return "application/wasm"
    default: return "application/octet-stream"
  }
}

export async function readRequestBytes(request, maxBytes = 100 * 1024 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.byteLength
    if (size > maxBytes) {
      throw new Error(`Request body exceeds ${maxBytes} bytes.`)
    }
    chunks.push(bytes)
  }
  return Buffer.concat(chunks, size)
}

export async function startStaticHarnessServer({ distRoot, handleRequest }) {
  const absoluteDistRoot = resolve(distRoot)
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1")
      if (handleRequest && await handleRequest({ request, response, url })) {
        return
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405).end()
        return
      }
      const relativePath = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1))
      const absolutePath = resolve(absoluteDistRoot, relativePath)
      if (absolutePath !== absoluteDistRoot && !absolutePath.startsWith(`${absoluteDistRoot}${sep}`)) {
        response.writeHead(404).end()
        return
      }
      const content = await readFile(absolutePath)
      response.writeHead(200, {
        "Content-Type": contentType(absolutePath),
        "Cache-Control": "no-store",
      })
      response.end(request.method === "HEAD" ? undefined : content)
    } catch {
      if (!response.headersSent) response.writeHead(404)
      response.end()
    }
  })

  await new Promise((resolveListen, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolveListen)
  })
  const address = server.address()
  if (!address || typeof address === "string") fail("Could not determine harness server address.")

  return {
    server,
    url: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise((resolveClose, rejectClose) => {
      server.close((error) => error ? rejectClose(error) : resolveClose())
    }),
  }
}

function launchBrowser(browser, url, profile) {
  const child = spawn(browser, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    `--user-data-dir=${profile}`,
    url,
  ], {
    windowsHide: true,
    stdio: ["ignore", "ignore", "pipe"],
  })
  let stderr = ""
  child.stderr.setEncoding("utf8")
  child.stderr.on("data", (chunk) => { stderr += chunk })
  return {
    child,
    exited: new Promise((resolveExit, rejectExit) => {
      child.once("error", rejectExit)
      child.once("close", (code) => resolveExit({ code, stderr }))
    }),
  }
}

export async function runInIsolatedBrowser({
  url,
  result,
  profilePrefix,
  timeoutMs,
  timeoutMessage,
}) {
  const browser = await findHeadlessBrowser()
  const profile = await mkdtemp(join(tmpdir(), profilePrefix))
  const launched = launchBrowser(browser, url, profile)
  let timeoutId
  try {
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
    })
    const completed = await Promise.race([
      result.then((value) => ({ kind: "result", value })),
      launched.exited.then((value) => ({ kind: "exit", value })),
      timeout,
    ])
    if (completed.kind === "exit") {
      fail(`Headless browser exited before reporting a result (code ${completed.value.code}).\n${completed.value.stderr}`)
    }
    return { browser, result: completed.value }
  } finally {
    clearTimeout(timeoutId)
    launched.child.kill()
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}
