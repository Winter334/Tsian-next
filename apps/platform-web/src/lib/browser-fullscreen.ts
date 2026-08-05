export type BrowserFullscreenRequestElement = Element & {
  webkitRequestFullscreen?: () => Promise<void> | void
  mozRequestFullScreen?: () => Promise<void> | void
  msRequestFullscreen?: () => Promise<void> | void
}

export type BrowserFullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null
  mozFullScreenElement?: Element | null
  msFullscreenElement?: Element | null
  webkitExitFullscreen?: () => Promise<void> | void
  mozCancelFullScreen?: () => Promise<void> | void
  msExitFullscreen?: () => Promise<void> | void
}

const FULLSCREEN_CHANGE_EVENTS = [
  "fullscreenchange",
  "webkitfullscreenchange",
  "mozfullscreenchange",
  "MSFullscreenChange",
] as const

export async function requestBrowserFullscreen(
  element: BrowserFullscreenRequestElement,
): Promise<boolean> {
  const request = element.requestFullscreen
    ?? element.webkitRequestFullscreen
    ?? element.mozRequestFullScreen
    ?? element.msRequestFullscreen
  if (!request) return false
  try {
    await Promise.resolve(request.call(element))
    return true
  } catch {
    return false
  }
}

export function browserFullscreenElement(
  targetDocument: Document = document,
): Element | null {
  const fullscreenDocument = targetDocument as BrowserFullscreenDocument
  return targetDocument.fullscreenElement
    ?? fullscreenDocument.webkitFullscreenElement
    ?? fullscreenDocument.mozFullScreenElement
    ?? fullscreenDocument.msFullscreenElement
    ?? null
}

export async function exitBrowserFullscreen(
  targetDocument: Document = document,
): Promise<void> {
  const fullscreenDocument = targetDocument as BrowserFullscreenDocument
  const exit = targetDocument.exitFullscreen
    ?? fullscreenDocument.webkitExitFullscreen
    ?? fullscreenDocument.mozCancelFullScreen
    ?? fullscreenDocument.msExitFullscreen
  if (!exit) return
  try {
    await Promise.resolve(exit.call(targetDocument))
  } catch {
    // The browser may reject after the user has already left fullscreen.
  }
}

export type WindowFullscreenResult = "native" | "window"

/**
 * Shares the browser-owned fullscreen branch between Retro and Spatial shells.
 * Shells still own window lookup and their own maximized/fullscreen state.
 */
export class BrowserWindowFullscreenController {
  private readonly targetDocument: Document
  private readonly applyWindowFullscreen: (id: string, fullscreen: boolean) => void
  private nativeWindowId = ""
  private started = false

  constructor(options: {
    readonly applyWindowFullscreen: (id: string, fullscreen: boolean) => void
    readonly document?: Document
  }) {
    this.applyWindowFullscreen = options.applyWindowFullscreen
    this.targetDocument = options.document ?? document
  }

  start(): void {
    if (this.started) return
    this.started = true
    for (const event of FULLSCREEN_CHANGE_EVENTS) {
      this.targetDocument.addEventListener(event, this.onFullscreenChange)
    }
  }

  async setWindowFullscreen(
    id: string,
    fullscreen: boolean,
    nativeElement: BrowserFullscreenRequestElement | null = null,
  ): Promise<WindowFullscreenResult> {
    if (fullscreen && nativeElement) {
      const entered = browserFullscreenElement(this.targetDocument) === nativeElement
        || await requestBrowserFullscreen(nativeElement)
      if (entered) {
        this.nativeWindowId = id
        this.applyWindowFullscreen(id, true)
        return "native"
      }
    } else if (
      !fullscreen
      && this.nativeWindowId === id
      && browserFullscreenElement(this.targetDocument)
    ) {
      await exitBrowserFullscreen(this.targetDocument)
      this.nativeWindowId = ""
    }

    this.applyWindowFullscreen(id, fullscreen)
    return "window"
  }

  dispose(): void {
    if (!this.started) return
    this.started = false
    for (const event of FULLSCREEN_CHANGE_EVENTS) {
      this.targetDocument.removeEventListener(event, this.onFullscreenChange)
    }
    this.nativeWindowId = ""
  }

  private readonly onFullscreenChange = (): void => {
    if (!this.nativeWindowId || browserFullscreenElement(this.targetDocument)) return
    const id = this.nativeWindowId
    this.nativeWindowId = ""
    this.applyWindowFullscreen(id, false)
  }
}
