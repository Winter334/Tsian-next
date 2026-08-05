import { describe, expect, it, vi } from "vitest"
import {
  BrowserWindowFullscreenController,
  browserFullscreenElement,
  exitBrowserFullscreen,
  requestBrowserFullscreen,
  type BrowserFullscreenDocument,
  type BrowserFullscreenRequestElement,
} from "./browser-fullscreen"

function fullscreenDocument() {
  const target = new EventTarget() as BrowserFullscreenDocument
  let current: Element | null = null
  Object.defineProperty(target, "fullscreenElement", {
    configurable: true,
    get: () => current,
  })
  Object.defineProperty(target, "current", {
    configurable: true,
    get: () => current,
    set: (value: Element | null) => { current = value },
  })
  return target as BrowserFullscreenDocument & { current: Element | null }
}

describe("browser fullscreen", () => {
  it("uses standard and vendor request/exit APIs without throwing on rejection", async () => {
    const standard = { requestFullscreen: vi.fn(async () => undefined) } as unknown as BrowserFullscreenRequestElement
    expect(await requestBrowserFullscreen(standard)).toBe(true)
    expect(standard.requestFullscreen).toHaveBeenCalledOnce()

    const vendorRequest = vi.fn(async () => undefined)
    const vendor = { webkitRequestFullscreen: vendorRequest } as unknown as BrowserFullscreenRequestElement
    expect(await requestBrowserFullscreen(vendor)).toBe(true)
    expect(vendorRequest).toHaveBeenCalledOnce()
    expect(await requestBrowserFullscreen({} as BrowserFullscreenRequestElement)).toBe(false)

    const targetDocument = fullscreenDocument()
    const exit = vi.fn(async () => undefined)
    targetDocument.webkitExitFullscreen = exit
    await exitBrowserFullscreen(targetDocument)
    expect(exit).toHaveBeenCalledOnce()
    targetDocument.webkitExitFullscreen = vi.fn(async () => { throw new Error("left") })
    await expect(exitBrowserFullscreen(targetDocument)).resolves.toBeUndefined()
  })

  it("reads standard and vendor fullscreen elements", () => {
    const targetDocument = fullscreenDocument()
    const element = {} as Element
    targetDocument.current = element
    expect(browserFullscreenElement(targetDocument)).toBe(element)
    targetDocument.current = null
    targetDocument.webkitFullscreenElement = element
    expect(browserFullscreenElement(targetDocument)).toBe(element)
  })

  it("shares native success, window fallback, explicit restore, and native-exit synchronization", async () => {
    const targetDocument = fullscreenDocument()
    const applied: Array<[string, boolean]> = []
    const controller = new BrowserWindowFullscreenController({
      document: targetDocument,
      applyWindowFullscreen: (id, fullscreen) => applied.push([id, fullscreen]),
    })
    controller.start()

    const iframe = {
      requestFullscreen: vi.fn(async () => { targetDocument.current = iframe as unknown as Element }),
    } as unknown as BrowserFullscreenRequestElement
    await expect(controller.setWindowFullscreen("play", true, iframe)).resolves.toBe("native")
    expect(applied).toEqual([["play", true]])

    targetDocument.current = null
    targetDocument.dispatchEvent(new Event("fullscreenchange"))
    expect(applied).toEqual([["play", true], ["play", false]])

    const rejected = {
      requestFullscreen: vi.fn(async () => { throw new Error("denied") }),
    } as unknown as BrowserFullscreenRequestElement
    await expect(controller.setWindowFullscreen("play", true, rejected)).resolves.toBe("window")
    expect(applied[applied.length - 1]).toEqual(["play", true])
    await controller.setWindowFullscreen("play", false)
    expect(applied[applied.length - 1]).toEqual(["play", false])
    controller.dispose()
  })

  it("removes every fullscreen listener on disposal", () => {
    const targetDocument = fullscreenDocument()
    const add = vi.spyOn(targetDocument, "addEventListener")
    const remove = vi.spyOn(targetDocument, "removeEventListener")
    const controller = new BrowserWindowFullscreenController({
      document: targetDocument,
      applyWindowFullscreen: vi.fn(),
    })
    controller.start()
    controller.start()
    expect(add).toHaveBeenCalledTimes(4)
    controller.dispose()
    controller.dispose()
    expect(remove).toHaveBeenCalledTimes(4)
  })
})
