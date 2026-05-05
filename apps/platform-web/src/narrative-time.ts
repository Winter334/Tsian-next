export function formatNarrativeTime(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  const hour = String(date.getHours()).padStart(2, "0")
  const minute = String(date.getMinutes()).padStart(2, "0")
  return `${year}-${month}-${day} ${hour}:${minute}`
}

export function getCurrentNarrativeTime(): string {
  return formatNarrativeTime(new Date())
}

export function addNarrativeTimeOffset(now: number, offsetMs: number): string {
  return formatNarrativeTime(new Date(now + offsetMs))
}

export function parseNarrativeTimeMs(value: string): number | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/)
  if (!match) {
    return null
  }

  const [, year, month, day, hour, minute] = match
  const time = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  ).getTime()

  return Number.isFinite(time) ? time : null
}
