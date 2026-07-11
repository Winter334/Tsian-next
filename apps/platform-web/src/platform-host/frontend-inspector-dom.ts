import type {
  InspectDomAction,
  InspectFrontendActionResult,
  InspectFrontendActionSnapshot,
  InspectFrontendInteractable,
  InspectFrontendResult,
  InspectFrontendStructure,
} from "../agent-runtime/workspace-tools"

const ACTION_WAIT_TIMEOUT_MS = 1_000
const MAX_DOM_DEPTH = 8
const MAX_ARIA_NAME = 80
const MAX_DOM_SUMMARY = 8_000
const MAX_INTERACTABLES = 80
const MAX_INTERACTABLE_TEXT = 120
const MAX_CONTROL_SIGNATURES = 200
const MAX_CONTROL_VALUE_SIGNATURE = 200
const INTERACTABLE_DATA_ATTRIBUTES = [
  "data-testid",
  "data-test",
  "data-action",
  "data-role",
]
const KEY_SELECTORS = [
  "#messages",
  "#message-list",
  ".messages",
  "#status",
  "#input",
  "#send",
  "#turn",
  ".msg",
  "[data-messages]",
]

const GENERIC_SKIP_CLASSES = new Set([
  "flex", "flex-col", "flex-row", "flex-row-reverse", "flex-1", "flex-shrink-0", "shrink-0", "grow",
  "grid", "grid-cols", "block", "inline", "inline-block", "inline-flex",
  "hidden", "relative", "absolute", "fixed", "sticky",
  "w-full", "h-full", "w-auto", "h-auto", "min-h-dvh", "h-dvh", "w-screen",
  "border-0", "border", "border-t", "border-b", "rounded", "rounded-lg",
  "bg-void", "bg-panel", "bg-transparent",
  "text-center", "text-left", "text-right", "text-sm", "text-xs", "text-lg",
  "p-0", "p-1", "p-2", "p-3", "p-4", "px-2", "px-3", "px-4", "py-1", "py-2",
  "m-0", "m-1", "m-2", "mx-auto", "mt-2", "mb-2", "gap-1", "gap-2", "gap-4",
  "overflow-hidden", "overflow-auto", "overflow-y-auto", "overflow-scroll",
  "cursor-pointer", "cursor-not-allowed", "select-none", "whitespace-pre-wrap",
  "items-center", "items-start", "items-end", "justify-center", "justify-between",
])

export interface InspectSnapshot {
  structure: InspectFrontendStructure
  errors: InspectFrontendResult["diagnostics"]["errors"]
}

export class InspectDomActionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
    readonly actionResults?: InspectFrontendActionResult[],
  ) {
    super(message)
    this.name = "InspectDomActionError"
  }
}

export function emptyInspectStructure(): InspectFrontendStructure {
  return {
    domSummary: "",
    computedStyles: [],
    renderedText: "",
    bridgeState: "loading",
  }
}

export function collectInspectStructure(
  doc: Document | null,
  bridgeState: InspectFrontendStructure["bridgeState"],
): InspectFrontendStructure {
  if (!doc?.body) {
    return {
      domSummary: "(contentDocument is unavailable or body is empty)",
      computedStyles: [],
      renderedText: "",
      bridgeState,
    }
  }
  return {
    domSummary: serializeAria(doc.body).slice(0, MAX_DOM_SUMMARY),
    computedStyles: collectKeyComputedStyles(doc),
    renderedText: extractRenderedText(doc),
    bridgeState,
  }
}

export function collectInspectInteractables(
  doc: Document | null,
): InspectFrontendInteractable[] {
  if (!doc?.body) return []
  const result: InspectFrontendInteractable[] = []
  for (const element of Array.from(doc.body.querySelectorAll("*"))) {
    if (result.length >= MAX_INTERACTABLES) break
    if (!isVisibleElement(element) || !shouldIncludeInteractable(element)) continue
    const kind = inferInteractableKind(element)
    const selector = selectorForElement(element)
    if (!selector) continue
    const summary: InspectFrontendInteractable = {
      ref: `i${result.length + 1}`,
      kind,
      selector,
      visible: true,
    }
    const name = shortElementName(element)
    if (name) summary.name = name
    appendElementState(summary, element)
    result.push(summary)
  }
  return result
}

function shouldIncludeInteractable(element: Element): boolean {
  const tag = element.tagName.toLowerCase()
  const role = element.getAttribute("role")?.trim().toLowerCase() ?? ""
  if (["button", "textarea", "select", "option"].includes(tag)) return true
  if (tag === "input" && (element as HTMLInputElement).type.toLowerCase() !== "hidden") return true
  if (tag === "a" && element.hasAttribute("href")) return true
  if ([
    "button",
    "link",
    "checkbox",
    "radio",
    "tab",
    "option",
    "menuitem",
    "combobox",
    "textbox",
    "dialog",
    "status",
    "alert",
  ].includes(role)) return true
  if (INTERACTABLE_DATA_ATTRIBUTES.some((name) => element.hasAttribute(name))) return true
  if (element.hasAttribute("aria-label")) return true
  return isClickableGeneric(element)
}

function inferInteractableKind(element: Element): InspectFrontendInteractable["kind"] {
  const tag = element.tagName.toLowerCase()
  const role = element.getAttribute("role")?.trim().toLowerCase() ?? ""
  if (tag === "input") {
    const type = (element as HTMLInputElement).type.toLowerCase()
    if (type === "checkbox") return "checkbox"
    if (type === "radio") return "radio"
    return "input"
  }
  if (tag === "textarea") return "textarea"
  if (tag === "select") return "select"
  if (tag === "option") return "option"
  if (tag === "button" || role === "button") return "button"
  if ((tag === "a" && element.hasAttribute("href")) || role === "link") return "link"
  if (role === "checkbox") return "checkbox"
  if (role === "radio") return "radio"
  if (role === "tab") return "tab"
  if (role === "option") return "option"
  if (tag === "dialog" || role === "dialog") return "dialog"
  if (role === "status" || role === "alert") return "status"
  if (hasCardSignal(element)) return "card"
  return "generic"
}

function shortElementName(element: Element): string {
  const name = computeAccessibleName(element)
  if (name) return name.slice(0, MAX_INTERACTABLE_TEXT)
  const text = element.textContent?.replace(/\s+/g, " ").trim() ?? ""
  return text.slice(0, MAX_INTERACTABLE_TEXT)
}

function appendElementState(
  target: InspectFrontendInteractable | NonNullable<InspectFrontendActionResult["target"]>,
  element: Element,
): void {
  const html = element as HTMLElement
  const tag = element.tagName.toLowerCase()
  const input = tag === "input" ? element as HTMLInputElement : null
  const textField = tag === "input" || tag === "textarea"
  if (element.getAttribute("aria-disabled") === "true" || ("disabled" in html && Boolean((html as HTMLButtonElement).disabled))) {
    target.disabled = true
  }
  if (element.getAttribute("aria-readonly") === "true" || (textField && Boolean((element as HTMLInputElement | HTMLTextAreaElement).readOnly))) {
    target.readonly = true
  }
  if (element.getAttribute("aria-checked") === "true" || Boolean(input?.checked)) {
    ;(target as InspectFrontendInteractable).checked = true
  }
  const expanded = element.getAttribute("aria-expanded")
  if (expanded === "true" || expanded === "false") {
    ;(target as InspectFrontendInteractable).expanded = expanded === "true"
  }
  const selected = element.getAttribute("aria-selected")
  if (selected === "true" || selected === "false") {
    ;(target as InspectFrontendInteractable).selected = selected === "true"
  }
}

function hasCardSignal(element: Element): boolean {
  return Array.from(element.classList).some((className) => (
    /(^|-)(card|method-card|option-card)(-|$)/i.test(className)
  )) || element.getAttribute("data-role")?.toLowerCase().includes("card") === true
}

function isClickableGeneric(element: Element): boolean {
  const html = element as HTMLElement
  if (hasCardSignal(element)) return shortElementName(element).length > 0
  if (element.hasAttribute("tabindex")) return true
  if (typeof html.onclick === "function") return true
  try {
    const style = element.ownerDocument.defaultView?.getComputedStyle(element)
    if (style?.cursor === "pointer" && shortElementName(element)) return true
  } catch {
    // Ignore style lookup failures for detached/replacing frames.
  }
  return false
}

function isVisibleElement(element: Element): boolean {
  if (element.getAttribute("aria-hidden") === "true" || element.hasAttribute("hidden")) {
    return false
  }
  const view = element.ownerDocument.defaultView
  if (!view) return false
  try {
    const style = view.getComputedStyle(element)
    if (style.display === "none" || style.visibility === "hidden") return false
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  } catch {
    return true
  }
}

function selectorForElement(element: Element): string | null {
  const doc = element.ownerDocument
  if (element.id) {
    const selector = `#${cssIdent(doc, element.id)}`
    if (isUniqueSelector(doc, selector, element)) return selector
  }
  for (const attr of INTERACTABLE_DATA_ATTRIBUTES) {
    const value = element.getAttribute(attr)
    if (!value) continue
    const selector = `${element.tagName.toLowerCase()}[${attr}="${cssString(value)}"]`
    if (isUniqueSelector(doc, selector, element)) return selector
  }
  const ariaLabel = element.getAttribute("aria-label")
  if (ariaLabel) {
    const selector = `${element.tagName.toLowerCase()}[aria-label="${cssString(ariaLabel)}"]`
    if (isUniqueSelector(doc, selector, element)) return selector
  }
  return cssPathForElement(element)
}

function cssPathForElement(element: Element): string | null {
  const doc = element.ownerDocument
  const parts: string[] = []
  let current: Element | null = element
  while (current && current !== doc.body && current !== doc.documentElement) {
    const tag = current.tagName.toLowerCase()
    let part = tag
    const stableClass = Array.from(current.classList)
      .find((className) => !GENERIC_SKIP_CLASSES.has(className) && !className.startsWith("vue-"))
    if (stableClass) {
      part += `.${cssIdent(doc, stableClass)}`
    }
    const parent: Element | null = current.parentElement
    if (parent) {
      const currentTag = current.tagName
      const sameTag = (Array.from(parent.children) as Element[])
        .filter((candidate) => candidate.tagName === currentTag)
      if (sameTag.length > 1) {
        part += `:nth-of-type(${sameTag.indexOf(current) + 1})`
      }
    }
    parts.unshift(part)
    const selector = parts.join(" > ")
    if (isUniqueSelector(doc, selector, element)) return selector
    current = parent
  }
  const selector = parts.join(" > ")
  return selector || null
}

function isUniqueSelector(doc: Document, selector: string, element: Element): boolean {
  try {
    const matches = doc.querySelectorAll(selector)
    return matches.length === 1 && matches[0] === element
  } catch {
    return false
  }
}

function cssIdent(doc: Document, value: string): string {
  const escape = doc.defaultView?.CSS?.escape ?? globalThis.CSS?.escape
  if (typeof escape === "function") return escape(value)
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&")
}

function cssString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")
}
export function computeInspectDiff(
  previous: InspectSnapshot | null,
  current: InspectSnapshot,
): InspectFrontendResult["diff"] | undefined {
  if (!previous) {
    return undefined
  }
  const added: string[] = []
  const removed: string[] = []
  const changed: { path: string; from: string; to: string }[] = []
  const previousErrors = new Set(previous.errors.map((error) => error.message))
  const currentErrors = new Set(current.errors.map((error) => error.message))

  for (const message of currentErrors) {
    if (!previousErrors.has(message)) added.push(`error: ${message}`)
  }
  for (const message of previousErrors) {
    if (!currentErrors.has(message)) removed.push(`error: ${message}`)
  }
  if (previous.structure.renderedText !== current.structure.renderedText) {
    changed.push({
      path: "renderedText",
      from: previous.structure.renderedText.slice(0, 200),
      to: current.structure.renderedText.slice(0, 200),
    })
  }

  const previousLines = new Set(previous.structure.domSummary.split("\n"))
  const currentLines = new Set(current.structure.domSummary.split("\n"))
  for (const line of currentLines) {
    if (line.trim() && !previousLines.has(line)) added.push(`dom: ${line.slice(0, 120)}`)
  }
  for (const line of previousLines) {
    if (line.trim() && !currentLines.has(line)) removed.push(`dom: ${line.slice(0, 120)}`)
  }

  return added.length || removed.length || changed.length
    ? { added, removed, changed }
    : undefined
}

export interface InspectDomActionExecution {
  snapshots: InspectFrontendActionSnapshot[]
  actions: InspectFrontendActionResult[]
}

export async function runInspectDomActions(
  doc: Document,
  actions: InspectDomAction[],
  options: {
    autoWait: boolean
    observeBetween: boolean
    bridgeState: () => InspectFrontendStructure["bridgeState"]
    activitySequence: () => number
  },
): Promise<InspectDomActionExecution> {
  const snapshots: InspectFrontendActionSnapshot[] = []
  const actionResults: InspectFrontendActionResult[] = []
  for (let step = 0; step < actions.length; step += 1) {
    const action = actions[step]!
    let matchedCount = 0
    let target: InspectFrontendActionResult["target"] | undefined
    const beforeSignature = domSignature(doc)
    const activityBefore = options.activitySequence()
    try {
      if (options.autoWait) {
        const actionable = await waitForActionable(doc, action.selector, ACTION_WAIT_TIMEOUT_MS)
        if (!actionable) {
          const element = querySelector(doc, action.selector)
          matchedCount = countSelectorMatches(doc, action.selector)
          target = element ? summarizeActionTarget(element, action.selector) : undefined
          throw new InspectDomActionError(
            "INSPECT_WAIT_TIMEOUT",
            `Timed out waiting for an actionable selector: ${action.selector}`,
            {
              selector: action.selector,
              timeoutMs: ACTION_WAIT_TIMEOUT_MS,
              step,
              found: Boolean(element),
              ...(element ? {
                tag: element.tagName.toLowerCase(),
                disabled: element.hasAttribute("disabled"),
                hidden: element.hasAttribute("hidden"),
                ariaHidden: element.getAttribute("aria-hidden"),
              } : {}),
            },
          )
        }
      }
      matchedCount = countSelectorMatches(doc, action.selector)
      const element = querySelector(doc, action.selector)
      target = element ? summarizeActionTarget(element, action.selector) : undefined
      applyAction(doc, action)
      await inspectMicroTick()
      const activityAfter = options.activitySequence()
      const result: InspectFrontendActionResult = {
        step,
        action,
        ok: true,
        matchedCount,
        ...(target ? { target } : {}),
        effect: {
          domChanged: beforeSignature !== domSignature(doc),
          bridgeTriggered: activityAfter > activityBefore,
        },
      }
      actionResults.push(result)
      if (options.observeBetween) {
        const structure = collectInspectStructure(doc, options.bridgeState())
        snapshots.push({
          step,
          action,
          after: {
            domSummary: structure.domSummary,
            bridgeState: structure.bridgeState,
          },
        })
      }
    } catch (error) {
      const failure = normalizeDomActionError(error)
      const activityAfter = options.activitySequence()
      actionResults.push({
        step,
        action,
        ok: false,
        matchedCount,
        ...(target ? { target } : {}),
        effect: {
          domChanged: beforeSignature !== domSignature(doc),
          bridgeTriggered: activityAfter > activityBefore,
        },
        error: {
          code: failure.code,
          message: failure.message,
          ...(failure.details !== undefined ? { details: failure.details } : {}),
        },
      })
      throw new InspectDomActionError(
        failure.code,
        failure.message,
        failure.details,
        actionResults,
      )
    }
  }
  return { snapshots, actions: actionResults }
}

function countSelectorMatches(doc: Document, selector: string): number {
  try {
    return doc.querySelectorAll(selector).length
  } catch {
    throw new InspectDomActionError(
      "INSPECT_SELECTOR_INVALID",
      `Invalid selector: ${selector}`,
      { selector },
    )
  }
}

function summarizeActionTarget(
  element: Element,
  selector: string,
): NonNullable<InspectFrontendActionResult["target"]> {
  const target: NonNullable<InspectFrontendActionResult["target"]> = {
    tag: element.tagName.toLowerCase(),
    role: computeAriaRole(element),
    selector,
    visible: isVisibleElement(element),
  }
  const name = shortElementName(element)
  if (name) target.name = name
  appendElementState(target, element)
  return target
}

function normalizeDomActionError(error: unknown): InspectDomActionError {
  if (error instanceof InspectDomActionError) return error
  return new InspectDomActionError(
    "INSPECT_ACTION_FAILED",
    error instanceof Error ? error.message : String(error),
  )
}

function domSignature(doc: Document): string {
  if (!doc.body) return ""
  return [
    doc.body.textContent?.replace(/\s+/g, " ").trim().slice(0, 2_000) ?? "",
    serializeAria(doc.body).slice(0, 4_000),
    controlStateSignature(doc),
  ].join("\n")
}

function controlStateSignature(doc: Document): string {
  const controls = Array.from(doc.querySelectorAll("input, textarea, select"))
    .slice(0, MAX_CONTROL_SIGNATURES)
  return controls.map((element, index) => {
    const selector = selectorForElement(element) ?? `${element.tagName.toLowerCase()}#${index}`
    const tag = element.tagName.toLowerCase()
    if (tag === "select") {
      const select = element as HTMLSelectElement
      const selected = Array.from(select.selectedOptions)
        .map((option) => option.value)
        .join(",")
        .slice(0, MAX_CONTROL_VALUE_SIGNATURE)
      return `${selector}:select:${select.value.slice(0, MAX_CONTROL_VALUE_SIGNATURE)}:${selected}`
    }
    if (tag === "textarea") {
      return `${selector}:textarea:${(element as HTMLTextAreaElement).value.slice(0, MAX_CONTROL_VALUE_SIGNATURE)}`
    }
    const input = element as HTMLInputElement
    const type = input.type.toLowerCase()
    if (type === "checkbox" || type === "radio") {
      return `${selector}:input:${type}:checked=${input.checked}`
    }
    return `${selector}:input:${type}:${input.value.slice(0, MAX_CONTROL_VALUE_SIGNATURE)}`
  }).join("\n")
}

export function inspectMicroTick(delayMs: number = 50): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs))
}

function requireView(doc: Document): Window & typeof globalThis {
  const view = doc.defaultView
  if (!view) {
    throw new InspectDomActionError(
      "INSPECT_FRONTEND_DOCUMENT_UNAVAILABLE",
      "The Play iframe document no longer has an active window.",
    )
  }
  return view as Window & typeof globalThis
}

function setFormValue(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
): void {
  const view = requireView(element.ownerDocument)
  const tag = element.tagName.toLowerCase()
  const prototype = tag === "input"
    ? view.HTMLInputElement.prototype
    : tag === "textarea"
      ? view.HTMLTextAreaElement.prototype
      : view.HTMLSelectElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set
  if (setter) {
    setter.call(element, value)
  } else {
    element.value = value
  }
}

function dispatchInput(
  element: Element,
  view: Window & typeof globalThis,
  inputType: string = "insertText",
  data: string | null = null,
): void {
  if (typeof view.InputEvent === "function") {
    element.dispatchEvent(new view.InputEvent("input", {
      bubbles: true,
      composed: true,
      data,
      inputType,
    }))
    return
  }
  element.dispatchEvent(new view.Event("input", { bubbles: true, composed: true }))
}

function dispatchBeforeInput(
  element: Element,
  view: Window & typeof globalThis,
  inputType: string,
  data: string | null,
): boolean {
  if (typeof view.InputEvent === "function") {
    return element.dispatchEvent(new view.InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      composed: true,
      data,
      inputType,
    }))
  }
  return element.dispatchEvent(new view.Event("beforeinput", {
    bubbles: true,
    cancelable: true,
    composed: true,
  }))
}

function dispatchChange(element: Element, view: Window & typeof globalThis): void {
  element.dispatchEvent(new view.Event("change", { bubbles: true, composed: true }))
}

function eventPoint(element: Element): { clientX: number; clientY: number } {
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) {
    throw new InspectDomActionError(
      "INSPECT_TARGET_NOT_VISIBLE",
      "Action target has no visible box to receive pointer input.",
      { tag: element.tagName.toLowerCase() },
    )
  }
  return {
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
  }
}

function assertPointerHitTarget(element: Element, point: { clientX: number; clientY: number }): void {
  const hit = element.ownerDocument.elementFromPoint(point.clientX, point.clientY)
  if (!hit || (hit !== element && !element.contains(hit) && !hit.contains(element))) {
    throw new InspectDomActionError(
      "INSPECT_TARGET_OBSCURED",
      "Action target does not receive pointer events at its center point.",
      {
        target: element.tagName.toLowerCase(),
        hit: hit?.tagName.toLowerCase() ?? null,
      },
    )
  }
}

function dispatchPointerOrMouseEvent(
  element: Element,
  view: Window & typeof globalThis,
  type: string,
  options: MouseEventInit & { pointerId?: number; pointerType?: string; isPrimary?: boolean },
): boolean {
  const hasPointerEvent = typeof view.PointerEvent === "function"
  const isPointerEvent = type.startsWith("pointer") && hasPointerEvent
  const EventConstructor = isPointerEvent ? view.PointerEvent : view.MouseEvent
  return element.dispatchEvent(new EventConstructor(type, options))
}

function pointerOptionsFor(element: Element): {
  mouseOptions: MouseEventInit
  pointerOptions: MouseEventInit & { pointerId: number; pointerType: string; isPrimary: boolean }
} {
  const point = eventPoint(element)
  assertPointerHitTarget(element, point)
  const mouseOptions: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    button: 0,
    buttons: 1,
    detail: 1,
    clientX: point.clientX,
    clientY: point.clientY,
  }
  return {
    mouseOptions,
    pointerOptions: {
      ...mouseOptions,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
    },
  }
}

function dispatchHoverSequence(element: Element, view: Window & typeof globalThis): void {
  const { mouseOptions, pointerOptions } = pointerOptionsFor(element)
  dispatchPointerOrMouseEvent(element, view, "pointerover", pointerOptions)
  dispatchPointerOrMouseEvent(element, view, "mouseover", mouseOptions)
  dispatchPointerOrMouseEvent(element, view, "pointerenter", { ...pointerOptions, bubbles: false })
  dispatchPointerOrMouseEvent(element, view, "mouseenter", { ...mouseOptions, bubbles: false })
  dispatchPointerOrMouseEvent(element, view, "pointermove", pointerOptions)
  dispatchPointerOrMouseEvent(element, view, "mousemove", mouseOptions)
}

function focusForActivation(element: Element): void {
  const focusable = element as HTMLElement
  if (typeof focusable.focus === "function") {
    focusable.focus({ preventScroll: true })
  }
}

function focusElement(element: Element, verify: boolean): void {
  const focusable = element as HTMLElement
  if (typeof focusable.focus !== "function") {
    throw new InspectDomActionError(
      "INSPECT_NOT_FOCUSABLE",
      `focus target is not focusable: ${element.tagName.toLowerCase()}`,
    )
  }
  focusable.focus({ preventScroll: true })
  if (verify && !isActiveElement(element)) {
    throw new InspectDomActionError(
      "INSPECT_FOCUS_FAILED",
      "focus action did not move focus to the target element.",
      {
        target: element.tagName.toLowerCase(),
        active: element.ownerDocument.activeElement?.tagName.toLowerCase() ?? null,
      },
    )
  }
}

function isActiveElement(element: Element): boolean {
  const active = element.ownerDocument.activeElement
  return active === element || Boolean(active && element.contains(active) && (element as HTMLElement).isContentEditable)
}

function assertActionableNow(element: Element): void {
  if (!isActionable(element)) {
    throw new InspectDomActionError(
      "INSPECT_NOT_ACTIONABLE",
      "Action target is not currently visible, enabled, and pointer-reachable.",
      {
        tag: element.tagName.toLowerCase(),
        disabled: element.hasAttribute("disabled"),
        hidden: element.hasAttribute("hidden"),
        ariaHidden: element.getAttribute("aria-hidden"),
        ariaDisabled: element.getAttribute("aria-disabled"),
      },
    )
  }
}

function activateElement(element: Element, view: Window & typeof globalThis): void {
  assertActionableNow(element)
  const target = element as HTMLElement
  element.scrollIntoView({ block: "center", inline: "center" })
  const { mouseOptions, pointerOptions } = pointerOptionsFor(element)

  dispatchPointerOrMouseEvent(element, view, "pointerover", pointerOptions)
  dispatchPointerOrMouseEvent(element, view, "mouseover", mouseOptions)
  dispatchPointerOrMouseEvent(element, view, "pointerenter", { ...pointerOptions, bubbles: false })
  dispatchPointerOrMouseEvent(element, view, "mouseenter", { ...mouseOptions, bubbles: false })
  const pointerDownAllowed = dispatchPointerOrMouseEvent(element, view, "pointerdown", pointerOptions)
  const mouseDownAllowed = dispatchPointerOrMouseEvent(element, view, "mousedown", mouseOptions)
  if (pointerDownAllowed && mouseDownAllowed) {
    focusForActivation(element)
  }
  dispatchPointerOrMouseEvent(element, view, "pointerup", { ...pointerOptions, buttons: 0 })
  dispatchPointerOrMouseEvent(element, view, "mouseup", { ...mouseOptions, buttons: 0 })
  if (typeof target.click === "function") {
    target.click()
  } else {
    element.dispatchEvent(new view.MouseEvent("click", {
      ...mouseOptions,
      buttons: 0,
    }))
  }
}

function isUnsupportedFileInput(element: Element): element is HTMLInputElement {
  return element.tagName.toLowerCase() === "input"
    && (element as HTMLInputElement).type.toLowerCase() === "file"
}

function isWritableTextInput(element: HTMLInputElement): boolean {
  const type = element.type.toLowerCase()
  return ![
    "button",
    "checkbox",
    "file",
    "hidden",
    "image",
    "radio",
    "reset",
    "submit",
  ].includes(type)
}

function assertEditableTarget(element: Element, action: "fill" | "type" | "press"): void {
  if (isUnsupportedFileInput(element)) {
    throw new InspectDomActionError(
      "INSPECT_FILE_INPUT_UNSUPPORTED",
      `${action} cannot manipulate file inputs; browser file selection is outside inspect_frontend DOM actions.`,
    )
  }
  const tag = element.tagName.toLowerCase()
  if (tag === "input") {
    const input = element as HTMLInputElement
    if (!isWritableTextInput(input)) {
      throw new InspectDomActionError(
        action === "fill" ? "INSPECT_NOT_FILLABLE" : "INSPECT_NOT_TYPEABLE",
        `${action} target is not a writable text input: ${input.type}`,
      )
    }
    if (input.disabled || input.readOnly) {
      throw new InspectDomActionError(
        "INSPECT_EDIT_BLOCKED",
        `${action} target is disabled or readonly.`,
      )
    }
    return
  }
  if (tag === "textarea") {
    const textarea = element as HTMLTextAreaElement
    if (textarea.disabled || textarea.readOnly) {
      throw new InspectDomActionError(
        "INSPECT_EDIT_BLOCKED",
        `${action} target is disabled or readonly.`,
      )
    }
    return
  }
  if (!(element as HTMLElement).isContentEditable) {
    throw new InspectDomActionError(
      action === "fill" ? "INSPECT_NOT_FILLABLE" : "INSPECT_NOT_TYPEABLE",
      `${action} target is not editable: ${element.tagName.toLowerCase()}`,
    )
  }
}

function readEditableText(element: Element): string {
  const tag = element.tagName.toLowerCase()
  if (tag === "input" || tag === "textarea") {
    return (element as HTMLInputElement | HTMLTextAreaElement).value
  }
  return element.textContent ?? ""
}

function setEditableText(element: Element, text: string): void {
  const tag = element.tagName.toLowerCase()
  if (tag === "input" || tag === "textarea") {
    setFormValue(element as HTMLInputElement | HTMLTextAreaElement, text)
    return
  }
  element.textContent = text
}

function replaceEditableText(
  element: Element,
  view: Window & typeof globalThis,
  text: string,
  inputType: string,
): void {
  if (!dispatchBeforeInput(element, view, inputType, text)) {
    throw new InspectDomActionError(
      "INSPECT_BEFOREINPUT_CANCELLED",
      "beforeinput cancelled the requested edit.",
      { inputType },
    )
  }
  setEditableText(element, text)
  dispatchInput(element, view, inputType, text)
}

function verifyEditableText(element: Element, expected: string, action: "fill" | "type" | "press"): void {
  const actual = readEditableText(element)
  if (actual !== expected) {
    throw new InspectDomActionError(
      "INSPECT_EDIT_VERIFY_FAILED",
      `${action} did not produce the requested editable value.`,
      {
        expectedLength: expected.length,
        actualLength: actual.length,
        expectedPreview: expected.slice(0, 120),
        actualPreview: actual.slice(0, 120),
      },
    )
  }
}

function insertTextIntoEditable(
  element: Element,
  view: Window & typeof globalThis,
  text: string,
  action: "type" | "press",
): void {
  const expected = `${readEditableText(element)}${text}`
  replaceEditableText(element, view, expected, "insertText")
  verifyEditableText(element, expected, action)
}

function keyboardInitFor(key: string): KeyboardEventInit {
  const normalized = normalizeKey(key)
  return {
    key: normalized.key,
    code: normalized.code,
    bubbles: true,
    cancelable: true,
    composed: true,
  }
}

function normalizeKey(key: string): { key: string; code: string } {
  if (key === "Space" || key === "Spacebar") return { key: " ", code: "Space" }
  if (key === "Esc") return { key: "Escape", code: "Escape" }
  if (/^[a-z]$/i.test(key)) return { key, code: `Key${key.toUpperCase()}` }
  if (/^\d$/.test(key)) return { key, code: `Digit${key}` }
  const codeByKey: Record<string, string> = {
    " ": "Space",
    ArrowDown: "ArrowDown",
    ArrowLeft: "ArrowLeft",
    ArrowRight: "ArrowRight",
    ArrowUp: "ArrowUp",
    Backspace: "Backspace",
    Delete: "Delete",
    End: "End",
    Enter: "Enter",
    Escape: "Escape",
    Home: "Home",
    Tab: "Tab",
  }
  return { key, code: codeByKey[key] ?? key }
}

function dispatchKeyboardEvent(
  element: Element,
  view: Window & typeof globalThis,
  type: "keydown" | "keyup",
  key: string,
): boolean {
  return element.dispatchEvent(new view.KeyboardEvent(type, keyboardInitFor(key)))
}

function isEditableElement(element: Element): boolean {
  const tag = element.tagName.toLowerCase()
  if (tag === "input") return isWritableTextInput(element as HTMLInputElement)
  return tag === "textarea" || (element as HTMLElement).isContentEditable
}

function isKeyboardActivatable(element: Element): boolean {
  const tag = element.tagName.toLowerCase()
  if (tag === "button") return true
  if (tag === "a" && element.hasAttribute("href")) return true
  if (tag !== "input") return false
  return ["button", "checkbox", "image", "radio", "reset", "submit"].includes(
    (element as HTMLInputElement).type.toLowerCase(),
  )
}

function moveFocusByTab(doc: Document, current: Element): void {
  const candidates = Array.from(doc.querySelectorAll<HTMLElement>([
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled]):not([type='hidden'])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[tabindex]:not([tabindex='-1'])",
    "[contenteditable='true']",
  ].join(","))).filter(isActionable)
  if (!candidates.length) {
    throw new InspectDomActionError(
      "INSPECT_TAB_TARGET_UNAVAILABLE",
      "No focusable target is available for Tab navigation.",
    )
  }
  const index = candidates.indexOf(current as HTMLElement)
  const next = candidates[(index + 1) % candidates.length]!
  focusElement(next, true)
}

function applyPressDefault(element: Element, view: Window & typeof globalThis, key: string): void {
  const normalized = normalizeKey(key).key
  const tag = element.tagName.toLowerCase()
  if (normalized === "Enter") {
    if (tag === "textarea" || (element as HTMLElement).isContentEditable) {
      assertEditableTarget(element, "press")
      insertTextIntoEditable(element, view, "\n", "press")
      return
    }
    if (tag === "input") {
      const input = element as HTMLInputElement
      if (isWritableTextInput(input)) {
        input.form?.requestSubmit()
        return
      }
    }
    if (isKeyboardActivatable(element)) {
      activateElement(element, view)
    }
    return
  }
  if (normalized === " ") {
    if (isEditableElement(element)) {
      assertEditableTarget(element, "press")
      insertTextIntoEditable(element, view, " ", "press")
      return
    }
    if (isKeyboardActivatable(element)) {
      activateElement(element, view)
    }
    return
  }
  if (normalized === "Tab") {
    moveFocusByTab(element.ownerDocument, element)
    return
  }
  if (normalized.length === 1 && isEditableElement(element)) {
    assertEditableTarget(element, "press")
    insertTextIntoEditable(element, view, normalized, "press")
  }
}

function applyAction(doc: Document, action: InspectDomAction): void {
  const element = querySelector(doc, action.selector)
  if (!element) {
    throw new InspectDomActionError(
      "INSPECT_SELECTOR_NOT_FOUND",
      `No element matches selector: ${action.selector}`,
      { selector: action.selector },
    )
  }
  const view = requireView(doc)
  const tag = element.tagName.toLowerCase()
  const isInput = tag === "input"
  const isSelect = tag === "select"

  switch (action.type) {
    case "click": {
      activateElement(element, view)
      return
    }
    case "type": {
      const text = action.text ?? ""
      assertEditableTarget(element, "type")
      focusElement(element, true)
      const expected = `${readEditableText(element)}${text}`
      for (const character of text) {
        const key = character === "\n" ? "Enter" : character
        const keydownAllowed = dispatchKeyboardEvent(element, view, "keydown", key)
        if (keydownAllowed) {
          if (!dispatchBeforeInput(element, view, "insertText", character)) {
            dispatchKeyboardEvent(element, view, "keyup", key)
            throw new InspectDomActionError(
              "INSPECT_BEFOREINPUT_CANCELLED",
              "beforeinput cancelled typed text insertion.",
              { character },
            )
          }
          setEditableText(element, `${readEditableText(element)}${character}`)
          dispatchInput(element, view, "insertText", character)
        }
        dispatchKeyboardEvent(element, view, "keyup", key)
      }
      dispatchChange(element, view)
      verifyEditableText(element, expected, "type")
      return
    }
    case "press": {
      const key = action.key ?? "Enter"
      focusElement(element, false)
      const applyDefault = dispatchKeyboardEvent(element, view, "keydown", key)
      if (applyDefault) {
        applyPressDefault(element, view, key)
      }
      dispatchKeyboardEvent(element, view, "keyup", key)
      return
    }
    case "scroll": {
      const target = element as HTMLElement
      const to = action.to ?? "top"
      const maxScrollTop = Math.max(0, target.scrollHeight - target.clientHeight)
      const targetTop = to === "bottom" ? maxScrollTop : 0
      if (typeof view.WheelEvent === "function") {
        target.dispatchEvent(new view.WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          composed: true,
          deltaY: to === "bottom" ? Math.max(100, maxScrollTop) : -Math.max(100, target.scrollTop),
        }))
      }
      target.scrollTop = targetTop
      target.dispatchEvent(new view.Event("scroll", { bubbles: true, composed: true }))
      if (Math.abs(target.scrollTop - targetTop) > 2) {
        throw new InspectDomActionError(
          "INSPECT_SCROLL_VERIFY_FAILED",
          `scroll did not reach ${to}.`,
          { expected: targetTop, actual: target.scrollTop },
        )
      }
      return
    }
    case "selectOption": {
      if (!isSelect) {
        throw new InspectDomActionError(
          "INSPECT_NOT_SELECT",
          `selectOption target is not a select: ${action.selector}`,
        )
      }
      const select = element as HTMLSelectElement
      if (select.disabled) {
        throw new InspectDomActionError("INSPECT_SELECT_DISABLED", "selectOption target is disabled.")
      }
      let value = action.value
      let option = value !== undefined
        ? Array.from(select.options).find((candidate) => candidate.value === value)
        : undefined
      if (value !== undefined && !option) {
        throw new InspectDomActionError(
          "INSPECT_OPTION_NOT_FOUND",
          `No option matches value: ${value}`,
        )
      }
      if (value === undefined && action.label) {
        option = Array.from(select.options)
          .find((candidate) => candidate.textContent?.trim() === action.label)
        value = option?.value
        if (value === undefined) {
          throw new InspectDomActionError(
            "INSPECT_OPTION_NOT_FOUND",
            `No option matches label: ${action.label}`,
          )
        }
      }
      if (value === undefined || !option) {
        throw new InspectDomActionError(
          "INSPECT_SELECT_NO_VALUE",
          "selectOption requires value or label.",
        )
      }
      if (option.disabled) {
        throw new InspectDomActionError(
          "INSPECT_OPTION_DISABLED",
          `Option is disabled: ${value}`,
        )
      }
      focusElement(element, false)
      setFormValue(select, value)
      dispatchInput(element, view, "insertReplacementText", value)
      dispatchChange(element, view)
      if (select.value !== value) {
        throw new InspectDomActionError(
          "INSPECT_SELECT_VERIFY_FAILED",
          "selectOption did not produce the requested selected value.",
          { expected: value, actual: select.value },
        )
      }
      return
    }
    case "check": {
      if (!isInput) {
        throw new InspectDomActionError(
          "INSPECT_NOT_CHECKABLE",
          `check target is not a checkbox or radio: ${action.selector}`,
        )
      }
      const input = element as HTMLInputElement
      const inputType = input.type.toLowerCase()
      if (inputType !== "checkbox" && inputType !== "radio") {
        throw new InspectDomActionError(
          "INSPECT_NOT_CHECKABLE",
          `check target is not a checkbox or radio: ${action.selector}`,
        )
      }
      if (input.disabled) {
        throw new InspectDomActionError("INSPECT_CHECK_DISABLED", "check target is disabled.")
      }
      const desired = action.checked !== false
      if (inputType === "radio" && !desired && input.checked) {
        throw new InspectDomActionError(
          "INSPECT_RADIO_UNCHECK_UNSUPPORTED",
          "A selected radio cannot be unchecked by a browser user action; select another radio instead.",
        )
      }
      if (input.checked !== desired) {
        activateElement(input, view)
      }
      if (input.checked !== desired) {
        throw new InspectDomActionError(
          "INSPECT_CHECK_VERIFY_FAILED",
          "check action did not produce the requested checked state.",
          { expected: desired, actual: input.checked, type: inputType },
        )
      }
      return
    }
    case "fill": {
      const text = action.text ?? ""
      assertEditableTarget(element, "fill")
      focusElement(element, true)
      replaceEditableText(element, view, text, "insertReplacementText")
      dispatchChange(element, view)
      verifyEditableText(element, text, "fill")
      return
    }
    case "hover":
      assertActionableNow(element)
      dispatchHoverSequence(element, view)
      return
    case "focus": {
      focusElement(element, true)
      return
    }
  }
}

function isActionable(element: Element): boolean {
  if (!("style" in element)) return false
  if (element.getAttribute("aria-hidden") === "true" || element.hasAttribute("hidden")) {
    return false
  }
  if (element.getAttribute("aria-disabled") === "true" || element.hasAttribute("disabled")) {
    return false
  }
  const view = element.ownerDocument.defaultView
  if (!view) return false
  try {
    const style = view.getComputedStyle(element)
    return style.display !== "none" && style.visibility !== "hidden"
  } catch {
    return true
  }
}

async function waitForActionable(
  doc: Document,
  selector: string,
  timeoutMs: number,
): Promise<boolean> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const element = querySelector(doc, selector)
    if (element && isActionable(element)) return true
    await inspectMicroTick(16)
  }
  return false
}

function querySelector(doc: Document, selector: string): Element | null {
  try {
    return doc.querySelector(selector)
  } catch {
    throw new InspectDomActionError(
      "INSPECT_SELECTOR_INVALID",
      `Invalid selector: ${selector}`,
      { selector },
    )
  }
}

function serializeAria(root: Element): string {
  const lines: string[] = []
  walkAria(root, 0, lines)
  return lines.join("\n")
}

function walkAria(element: Element, depth: number, output: string[]): void {
  if (depth > MAX_DOM_DEPTH || !isRelevantForAria(element)) return
  const role = computeAriaRole(element)
  const name = computeAccessibleName(element)
  const state = computeAriaState(element)
  const identifier = role === "generic" ? computeGenericIdentifier(element) : ""
  output.push(
    `${"  ".repeat(depth)}- ${role}${identifier}${name ? ` "${name}"` : ""}${state ? ` [${state}]` : ""}`,
  )
  for (const child of Array.from(element.children)) {
    walkAria(child, depth + 1, output)
  }
}

function computeGenericIdentifier(element: Element): string {
  if (element.id) return ` #${element.id}`
  for (const className of Array.from(element.classList)) {
    if (!GENERIC_SKIP_CLASSES.has(className) && !className.startsWith("vue-")) {
      return ` .${className}`
    }
  }
  return ""
}

function isRelevantForAria(element: Element): boolean {
  const tag = element.tagName.toLowerCase()
  if (["script", "style", "link", "meta", "head"].includes(tag)) return false
  if (element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === "true") {
    return false
  }
  const style = element.ownerDocument.defaultView?.getComputedStyle(element)
  return !style || (style.display !== "none" && style.visibility !== "hidden")
}

function computeAriaRole(element: Element): string {
  const explicit = element.getAttribute("role")?.trim().toLowerCase()
  if (explicit) return explicit === "none" || explicit === "presentation" ? "generic" : explicit
  const tag = element.tagName.toLowerCase()
  if (tag === "input") {
    const type = (element as HTMLInputElement).type.toLowerCase()
    if (type === "checkbox") return "checkbox"
    if (type === "radio") return "radio"
    if (["button", "submit", "reset", "image"].includes(type)) return "button"
    return "textbox"
  }
  const roleByTag: Record<string, string> = {
    button: "button",
    a: "link",
    textarea: "textbox",
    select: "combobox",
    ul: "list",
    ol: "list",
    li: "listitem",
    nav: "navigation",
    img: "img",
    p: "paragraph",
    table: "table",
    tr: "row",
    td: "cell",
    th: "columnheader",
    form: "form",
    dialog: "dialog",
    details: "group",
    summary: "button",
    figure: "figure",
    blockquote: "blockquote",
  }
  if (/^h[1-6]$/.test(tag)) return "heading"
  if (["section", "article", "main", "aside", "header", "footer"].includes(tag)) return tag
  return roleByTag[tag] ?? "generic"
}

function computeAccessibleName(element: Element): string {
  const ariaLabel = element.getAttribute("aria-label")?.trim()
  if (ariaLabel) return ariaLabel.slice(0, MAX_ARIA_NAME)
  const labelledBy = element.getAttribute("aria-labelledby")
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => element.ownerDocument.getElementById(id)?.textContent?.trim() ?? "")
      .filter(Boolean)
      .join(" ")
    if (text) return text.slice(0, MAX_ARIA_NAME)
  }

  const tag = element.tagName.toLowerCase()
  if (["input", "textarea", "select"].includes(tag)) {
    const placeholder = (element as HTMLInputElement).placeholder?.trim()
    if (placeholder) return placeholder.slice(0, MAX_ARIA_NAME)
    if (element.id) {
      const label = Array.from(element.ownerDocument.querySelectorAll("label[for]"))
        .find((candidate) => candidate.getAttribute("for") === element.id)
        ?.textContent
        ?.trim()
      if (label) return label.slice(0, MAX_ARIA_NAME)
    }
  }
  if (tag === "img") {
    const alt = element.getAttribute("alt")?.trim()
    if (alt) return alt.slice(0, MAX_ARIA_NAME)
  }
  if (isNameFromContents(element, tag)) {
    const text = element.textContent?.trim()
    if (text) return text.slice(0, MAX_ARIA_NAME)
  }
  return element.getAttribute("title")?.trim().slice(0, MAX_ARIA_NAME) ?? ""
}

function isNameFromContents(element: Element, tag: string): boolean {
  if (/^h[1-6]$/.test(tag) || ["button", "a", "li", "td", "th"].includes(tag)) {
    return true
  }
  const role = element.getAttribute("role")?.trim().toLowerCase()
  return Boolean(role && [
    "button",
    "link",
    "heading",
    "menuitem",
    "tab",
    "option",
    "treeitem",
    "listitem",
    "cell",
    "columnheader",
    "rowheader",
  ].includes(role))
}

function computeAriaState(element: Element): string {
  const parts: string[] = []
  const tag = element.tagName.toLowerCase()
  const isInput = tag === "input"
  const isTextField = isInput || tag === "textarea"
  if (element.getAttribute("aria-disabled") === "true" || element.hasAttribute("disabled")) {
    parts.push("disabled")
  }
  if (
    element.getAttribute("aria-checked") === "true"
    || (isInput && (element as HTMLInputElement).checked)
  ) {
    parts.push("checked")
  }
  for (const state of ["expanded", "selected"] as const) {
    const value = element.getAttribute(`aria-${state}`)
    if (value !== null) parts.push(`${state}=${value}`)
  }
  if (
    element.getAttribute("aria-readonly") === "true"
    || (isTextField && (element as HTMLInputElement).readOnly)
  ) {
    parts.push("readonly")
  }
  if (
    element.getAttribute("aria-required") === "true"
    || ((isTextField || tag === "select") && (element as HTMLInputElement).required)
  ) {
    parts.push("required")
  }
  if (/^h[1-6]$/.test(tag)) {
    parts.push(`level=${tag[1]}`)
  } else {
    const level = element.getAttribute("aria-level")
    if (level && /^\d+$/.test(level)) parts.push(`level=${level}`)
  }
  return parts.join(" ")
}

function collectKeyComputedStyles(doc: Document): Record<string, string>[] {
  const result: Record<string, string>[] = []
  for (const selector of KEY_SELECTORS) {
    const element = doc.querySelector(selector)
    const style = element ? doc.defaultView?.getComputedStyle(element) : null
    if (style) {
      result.push({
        selector,
        display: style.display,
        visibility: style.visibility,
        color: style.color,
        backgroundColor: style.backgroundColor,
        width: style.width,
        height: style.height,
      })
    }
  }
  return result
}

function extractRenderedText(doc: Document): string {
  for (const selector of ["#messages", "#message-list", ".messages", "[data-messages]"]) {
    const text = doc.querySelector(selector)?.textContent?.trim()
    if (text) return text.slice(0, 4_000)
  }
  return doc.body.textContent?.trim().slice(0, 4_000) ?? ""
}
