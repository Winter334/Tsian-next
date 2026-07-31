<script setup lang="ts">
import { computed, reactive, ref } from "vue"

const props = defineProps<{
  sourceId: "left" | "center" | "right"
  title: string
  zIndex: number
}>()

const emit = defineEmits<{
  probe: [sourceId: string, key: string, detail: string]
}>()

const textValue = ref("")
const textareaValue = ref("")
const checked = ref(false)
const radioValue = ref("alpha")
const rangeValue = ref(45)
const selectOptions = [
  { value: "cyan", label: "Cyan signal", code: "C-01" },
  { value: "orange", label: "Amber alert", code: "A-17" },
  { value: "white", label: "White relay", code: "W-08" },
] as const
type SelectValue = typeof selectOptions[number]["value"]
const selectValue = ref<SelectValue>("cyan")
const nativeSelectValue = ref<SelectValue>("cyan")
const selectOpen = ref(false)
const editableText = ref("Editable telemetry")
const fileName = ref("none")
const doubleClicks = ref(0)
const contextMessage = ref("none")
const dragBox = reactive({ x: 8, y: 8, width: 112, height: 58 })

type ResizeDirection = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw"
type DragOperation = {
  readonly pointerId: number
  readonly kind: "move" | "resize"
  readonly direction?: ResizeDirection
  readonly startX: number
  readonly startY: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

let operation: DragOperation | null = null

const dragStyle = computed(() => ({
  left: `${dragBox.x}px`,
  top: `${dragBox.y}px`,
  width: `${dragBox.width}px`,
  height: `${dragBox.height}px`,
}))
const selectedOption = computed(
  () => selectOptions.find((option) => option.value === selectValue.value) ?? selectOptions[0],
)

function probe(key: string, detail: string): void {
  emit("probe", props.sourceId, key, detail)
}

function beginMove(event: PointerEvent): void {
  operation = {
    pointerId: event.pointerId,
    kind: "move",
    startX: event.clientX,
    startY: event.clientY,
    ...dragBox,
  }
  probe("drag", "started")
}

function beginResize(direction: ResizeDirection, event: PointerEvent): void {
  event.stopPropagation()
  operation = {
    pointerId: event.pointerId,
    kind: "resize",
    direction,
    startX: event.clientX,
    startY: event.clientY,
    ...dragBox,
  }
  probe("resize", `${direction} started`)
}

function updateOperation(event: PointerEvent): void {
  if (!operation || event.pointerId !== operation.pointerId) return
  const dx = event.clientX - operation.startX
  const dy = event.clientY - operation.startY
  if (operation.kind === "move") {
    dragBox.x = Math.max(0, Math.min(132, operation.x + dx))
    dragBox.y = Math.max(0, Math.min(42, operation.y + dy))
    return
  }
  const direction = operation.direction ?? "se"
  const movesWest = direction.includes("w")
  const movesNorth = direction.includes("n")
  if (direction.includes("e")) dragBox.width = Math.max(64, operation.width + dx)
  if (direction.includes("s")) dragBox.height = Math.max(40, operation.height + dy)
  if (movesWest) {
    const width = Math.max(64, operation.width - dx)
    dragBox.x = operation.x + operation.width - width
    dragBox.width = width
  }
  if (movesNorth) {
    const height = Math.max(40, operation.height - dy)
    dragBox.y = operation.y + operation.height - height
    dragBox.height = height
  }
}

function finishOperation(event: PointerEvent): void {
  if (!operation || event.pointerId !== operation.pointerId) return
  probe(operation.kind, `${Math.round(dragBox.width)}×${Math.round(dragBox.height)} at ${Math.round(dragBox.x)},${Math.round(dragBox.y)}`)
  operation = null
}

function onFile(event: Event): void {
  const input = event.target as HTMLInputElement
  fileName.value = input.files?.[0]?.name ?? "none"
  probe("file", fileName.value)
}

function toggleSelect(): void {
  selectOpen.value = !selectOpen.value
  probe("select", selectOpen.value ? "opened" : "closed")
}

function chooseSelect(value: SelectValue): void {
  selectValue.value = value
  selectOpen.value = false
  probe("select", value)
}

function closeSelectOnFocusOut(event: FocusEvent): void {
  const next = event.relatedTarget
  if (next instanceof Node && (event.currentTarget as HTMLElement).contains(next)) return
  selectOpen.value = false
}

function onSelectKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    selectOpen.value = false
    return
  }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
  event.preventDefault()
  const current = selectOptions.findIndex((option) => option.value === selectValue.value)
  const direction = event.key === "ArrowDown" ? 1 : -1
  const next = (current + direction + selectOptions.length) % selectOptions.length
  chooseSelect((selectOptions[next] ?? selectOptions[0]).value)
}

function onKeydown(event: KeyboardEvent): void {
  const key = event.key === " " ? "Space" : event.key
  if (["Tab", "Enter", "Space", "Escape"].includes(key)) {
    const suffix = key === "Tab" && event.shiftKey ? "Shift+Tab" : key
    probe(`keyboard-${key.toLowerCase()}`, suffix)
  }
}

function onFocusIn(event: FocusEvent): void {
  const target = event.target as Element | null
  const focusVisible = target?.matches?.(":focus-visible") ?? false
  probe("focus-visible", focusVisible ? "visible" : "focused (pointer modality)")
}
</script>

<template>
  <section
    class="lab-surface"
    :class="`lab-surface--${sourceId}`"
    :data-spatial-source="sourceId"
    :data-spatial-z="zIndex"
    :style="{ zIndex }"
    :aria-label="`${title} interaction surface`"
    @keydown="onKeydown"
    @focusin="onFocusIn"
  >
    <header class="lab-surface__header">
      <span class="lab-surface__identity">
        <small>SPATIAL NODE // {{ sourceId }}</small>
        <strong>{{ title }}</strong>
      </span>
      <span class="lab-surface__telemetry">
        <i aria-hidden="true" />
        <span>SYNC</span>
        <output>{{ sourceId.toUpperCase() }} / Z{{ zIndex }}</output>
      </span>
    </header>

    <svg
      class="lab-surface__diagram"
      viewBox="0 0 240 110"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
      data-spatial-ignore
    >
      <g class="lab-surface__diagram-grid">
        <path d="M8 16 H232 M8 42 H232 M8 68 H232 M8 94 H232" />
        <path d="M24 6 V104 M68 6 V104 M112 6 V104 M156 6 V104 M200 6 V104" />
      </g>
      <g class="lab-surface__diagram-data">
        <path d="M18 80 H62 L78 62 H116 L134 44 H174" />
        <path d="M40 28 H86 L98 38 H144 L158 26 H212" />
        <circle cx="78" cy="62" r="3" />
        <circle cx="134" cy="44" r="3" />
        <circle cx="158" cy="26" r="3" />
        <path d="M188 70 H220 M204 54 V86" />
        <circle cx="204" cy="70" r="13" />
      </g>
      <path class="lab-surface__diagram-alert" d="M18 92 H54" />
    </svg>

    <div class="lab-surface__grid">
      <div class="lab-control-group">
        <button :id="`${sourceId}-button`" data-probe="button" type="button" @click="probe('button', 'click')">
          Execute
        </button>
        <a :id="`${sourceId}-link`" data-probe="link" href="#spatial-lab-link" @click.prevent="probe('link', 'activated')">
          Route link
        </a>
        <button data-probe="double-click" type="button" @dblclick="doubleClicks += 1; probe('double-click', String(doubleClicks))">
          Double {{ doubleClicks }}
        </button>
      </div>

      <label>
        Signal input
        <input
          :id="`${sourceId}-text`"
          v-model="textValue"
          data-probe="text-input"
          autocomplete="off"
          @input="probe('text-input', textValue)"
          @compositionstart="probe('ime', 'compositionstart')"
          @compositionupdate="probe('ime', 'compositionupdate')"
          @compositionend="probe('ime', 'compositionend')"
        >
      </label>

      <label>
        Message buffer
        <textarea
          :id="`${sourceId}-textarea`"
          v-model="textareaValue"
          data-probe="textarea"
          rows="2"
          @input="probe('textarea', textareaValue)"
          @compositionend="probe('ime-textarea', 'compositionend')"
        />
      </label>

      <fieldset class="lab-choice-row">
        <legend>Native state</legend>
        <label>
          <input
            v-model="checked"
            data-probe="checkbox"
            type="checkbox"
            @change="probe('checkbox', String(checked))"
          >
          armed
        </label>
        <label>
          <input v-model="radioValue" data-probe="radio-alpha" type="radio" value="alpha" @change="probe('radio', radioValue)">
          A
        </label>
        <label>
          <input v-model="radioValue" data-probe="radio-beta" type="radio" value="beta" @change="probe('radio', radioValue)">
          B
        </label>
      </fieldset>

      <label>
        Range {{ rangeValue }}
        <input
          v-model="rangeValue"
          data-probe="range"
          type="range"
          min="0"
          max="100"
          @input="probe('range', String(rangeValue))"
          @change="probe('range-change', String(rangeValue))"
        >
      </label>

      <div class="lab-picker-row">
        <div class="lab-custom-select" :class="{ 'lab-custom-select--open': selectOpen }" @focusout="closeSelectOnFocusOut">
          <span class="lab-field-label">Signal palette</span>
          <button
            :id="`${sourceId}-select`"
            class="lab-custom-select__trigger"
            data-probe="select"
            type="button"
            role="combobox"
            aria-haspopup="listbox"
            :aria-controls="`${sourceId}-select-options`"
            :aria-expanded="selectOpen"
            @click="toggleSelect"
            @keydown="onSelectKeydown"
          >
            <i :data-tone="selectValue" aria-hidden="true" />
            <strong>{{ selectedOption.label }}</strong>
            <small>{{ selectedOption.code }}</small>
            <span aria-hidden="true">⌄</span>
          </button>
          <div
            v-if="selectOpen"
            :id="`${sourceId}-select-options`"
            class="lab-custom-select__options"
            role="listbox"
            :aria-label="`${title} signal palette`"
          >
            <button
              v-for="option in selectOptions"
              :key="option.value"
              class="lab-custom-select__option"
              :class="{ 'lab-custom-select__option--selected': option.value === selectValue }"
              type="button"
              role="option"
              :aria-selected="option.value === selectValue"
              @click="chooseSelect(option.value)"
            >
              <i :data-tone="option.value" aria-hidden="true" />
              <strong>{{ option.label }}</strong>
              <small>{{ option.code }}</small>
            </button>
          </div>
        </div>
        <label class="lab-native-select-label">
          Native select escape
          <select
            v-model="nativeSelectValue"
            data-probe="native-select"
            @change="probe('native-select', nativeSelectValue)"
          >
            <option v-for="option in selectOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </label>
        <label class="lab-file-label">
          File escape
          <input data-probe="file" type="file" @change="onFile">
          <output>{{ fileName }}</output>
        </label>
      </div>

      <div>
        <span class="lab-field-label">Contenteditable</span>
        <div
          :id="`${sourceId}-editable`"
          class="lab-editable"
          contenteditable="true"
          data-probe="contenteditable"
          role="textbox"
          aria-multiline="true"
          @input="editableText = ($event.target as HTMLElement).innerText; probe('contenteditable', editableText)"
        >{{ editableText }}</div>
      </div>

      <div
        class="lab-overlap"
        data-probe="clipped-stack"
        @contextmenu.prevent="contextMessage = 'mapped context menu'; probe('contextmenu', contextMessage)"
      >
        <button class="lab-overlap__bottom" data-probe="z-bottom" type="button" @click="probe('z-order', 'bottom')">Bottom</button>
        <button class="lab-overlap__top" data-probe="z-top" type="button" @click="probe('z-order', 'top')">Top target</button>
        <span class="lab-overlap__passthrough" data-spatial-ignore>pointer-none helper</span>
      </div>

      <div class="lab-scroll" data-probe="nested-scroll" tabindex="0" @scroll="probe('scroll-event', String(($event.target as HTMLElement).scrollTop))">
        <div v-for="index in 8" :key="index" class="lab-scroll__row">Nested row {{ index }}</div>
      </div>

      <div class="lab-drag-zone" aria-label="Drag and eight-handle resize probe">
        <div
          class="lab-drag-box"
          data-lab-drag
          data-probe="drag-box"
          :style="dragStyle"
          @pointerdown="beginMove"
          @pointermove="updateOperation"
          @pointerup="finishOperation"
          @pointercancel="finishOperation"
        >
          DRAG / RESIZE
          <button
            v-for="direction in (['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as ResizeDirection[])"
            :key="direction"
            type="button"
            class="lab-resize-handle"
            :class="`lab-resize-handle--${direction}`"
            :data-resize="direction"
            :aria-label="`Resize ${direction}`"
            @pointerdown="beginResize(direction, $event)"
            @pointermove="updateOperation"
            @pointerup="finishOperation"
            @pointercancel="finishOperation"
          />
        </div>
      </div>
    </div>

    <footer class="lab-surface__footer">
      <span><i aria-hidden="true" /> context: {{ contextMessage }}</span>
      <span>focus / IME // source live</span>
    </footer>
  </section>
</template>
