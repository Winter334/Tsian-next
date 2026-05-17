import { ref, onScopeDispose } from 'vue'

export interface TypewriterOptions {
  typeSpeedMs?: number    // default: 45
  eraseSpeedMs?: number   // default: 20
  pauseAfterGroupMs?: number // default: 1200
  pauseAfterEraseMs?: number // default: 400
}

export function useTypewriter(groups: string[][], options: TypewriterOptions = {}) {
  const {
    typeSpeedMs = 45,
    eraseSpeedMs = 20,
    pauseAfterGroupMs = 1200,
    pauseAfterEraseMs = 400,
  } = options

  const displayedLines = ref<string[]>([])
  let cancelled = false

  const delay = (ms: number) =>
    new Promise<void>((resolve) => {
      const id = setTimeout(resolve, ms)
      // If cancelled while waiting, resolve immediately won't matter
      // since we check `cancelled` after every await
      disposables.push(() => clearTimeout(id))
    })

  const disposables: Array<() => void> = []

  const run = async () => {
    let groupIndex = 0
    while (!cancelled) {
      const group = groups[groupIndex]
      displayedLines.value = []

      // Type phase: character by character, line by line
      for (let lineIdx = 0; lineIdx < group.length; lineIdx++) {
        if (cancelled) return
        displayedLines.value.push('')
        const line = group[lineIdx]
        for (let charIdx = 0; charIdx < line.length; charIdx++) {
          if (cancelled) return
          displayedLines.value[lineIdx] += line[charIdx]
          await delay(typeSpeedMs)
        }
      }

      if (cancelled) return
      await delay(pauseAfterGroupMs)

      // Erase phase: character by character, last line first
      for (let lineIdx = displayedLines.value.length - 1; lineIdx >= 0; lineIdx--) {
        while (displayedLines.value[lineIdx].length > 0) {
          if (cancelled) return
          displayedLines.value[lineIdx] = displayedLines.value[lineIdx].slice(0, -1)
          await delay(eraseSpeedMs)
        }
        if (lineIdx > 0) {
          displayedLines.value.pop()
        }
      }
      // Clear completely
      displayedLines.value = []

      if (cancelled) return
      await delay(pauseAfterEraseMs)

      groupIndex = (groupIndex + 1) % groups.length
    }
  }

  const stop = () => {
    cancelled = true
    disposables.forEach((fn) => fn())
    disposables.length = 0
  }

  onScopeDispose(stop)

  return { displayedLines, stop, start: run }
}
