export interface MagicCircleSvg {
  viewBox: string
  layers: string
}

type Rng = () => number

const SIZE = 512
const HALF = SIZE / 2

const COLORS = {
  ember: "var(--ember)",
  emberBright: "var(--ember-bright)",
  blood: "var(--blood)",
  prose: "var(--prose)",
  whisper: "var(--whisper)",
}

const SYMBOL_SETS = [
  "♈♉♊♋♌♍♎♏♐♑♒♓",
  "☉☽☾☿♀♁♂♃♄♅♆♇",
  "ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ",
  "ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛟᛞ",
]

function normalizeSeed(seed?: number): number {
  if (typeof seed === "number" && Number.isFinite(seed)) return seed >>> 0
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0
}

function mulberry32(seed: number): Rng {
  let t = seed >>> 0
  return function rng() {
    t += 0x6D2B79F5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

function randInt(rng: Rng, min: number, max: number): number {
  return Math.floor(rng() * (max - min)) + min
}

function choice<T>(rng: Rng, values: readonly T[]): T {
  return values[Math.floor(rng() * values.length)]
}

function fromPolar(radius: number, angle: number) {
  const a = angle * Math.PI * 2
  return {
    x: HALF + radius * HALF * Math.sin(a),
    y: HALF - radius * HALF * Math.cos(a),
  }
}

function pointString(radius: number, angle: number): string {
  const point = fromPolar(radius, angle)
  return `${point.x.toFixed(2)},${point.y.toFixed(2)}`
}

function circle(radius: number, color: string, width: number, opacity = 1, extraClass = ""): string {
  return `<circle class="${extraClass}" cx="${HALF}" cy="${HALF}" r="${(radius * HALF).toFixed(2)}" fill="none" stroke="${color}" stroke-width="${width}" opacity="${opacity}"/>`
}

function polygon(points: string, color: string, width: number, opacity = 1, fill = "none", extraClass = ""): string {
  return `<polygon class="${extraClass}" points="${points}" fill="${fill}" stroke="${color}" stroke-width="${width}" opacity="${opacity}"/>`
}

function nGram(rng: Rng, n: number, m: number, radius: number, offset = 0, color = COLORS.emberBright, width = 2, opacity = 0.85): string {
  const points: string[] = []
  let side = 0
  for (let i = 0; i < n; i += 1) {
    points.push(pointString(radius, side / n + offset))
    side = (side + m) % n
  }
  return polygon(points.join(" "), color, width, opacity)
}

function solidStar(n: number, outerRadius: number, innerRadius: number, offset: number, color: string, width: number, opacity: number, fill = "none"): string {
  const points: string[] = []
  for (let i = 0; i < n; i += 1) {
    points.push(pointString(outerRadius, i / n + offset))
    points.push(pointString(innerRadius, (i + 0.5) / n + offset))
  }
  return polygon(points.join(" "), color, width, opacity, fill)
}

function arcGram(n: number, step: number, radius: number, bow: number, offset: number, color: string, width: number, opacity: number): string {
  let d = ""
  let side = 0
  const arcR = radius * HALF * bow
  const first = fromPolar(radius, offset)
  d += `M ${first.x.toFixed(2)} ${first.y.toFixed(2)} `
  for (let i = 0; i < n; i += 1) {
    side = (side + step) % n
    const point = fromPolar(radius, side / n + offset)
    d += `A ${arcR.toFixed(2)} ${arcR.toFixed(2)} 0 0 0 ${point.x.toFixed(2)} ${point.y.toFixed(2)} `
  }
  d += "Z"
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" opacity="${opacity}"/>`
}

function textRing(rng: Rng, radius: number, id: string, color: string, opacity: number, sizeMin = 12, sizeMax = 16): string {
  const set = choice(rng, SYMBOL_SETS)
  const chars = Array.from(set)
  const circumference = 2 * Math.PI * radius * HALF
  const size = randInt(rng, sizeMin, sizeMax + 1)
  const targetStep = size * 0.88
  const count = Math.max(36, Math.round(circumference / targetStep))
  let text = ""
  for (let i = 0; i < count; i += 1) text += choice(rng, chars)

  const r = radius * HALF
  const top = fromPolar(radius, 0)
  const right = fromPolar(radius, 0.25)
  const path = `<path id="${id}" d="M ${top.x.toFixed(2)} ${top.y.toFixed(2)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 0 1 ${right.x.toFixed(2)} ${right.y.toFixed(2)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 1 1 ${top.x.toFixed(2)} ${top.y.toFixed(2)} Z" fill="none" stroke="none"/>`
  const textLength = (circumference * 0.995).toFixed(2)
  return `${path}<text class="magic-rune" fill="${color}" opacity="${opacity}" font-family="Segoe UI Symbol, Noto Serif SC, serif" font-size="${size}" textLength="${textLength}" lengthAdjust="spacing"><textPath href="#${id}" startOffset="0%">${text}</textPath></text>`
}

function textRingLayer(rng: Rng, radius: number, id: string, opacity: number): string {
  const fontMin = radius > 0.72 ? 12 : radius > 0.52 ? 11 : 10
  const fontMax = radius > 0.72 ? 15 : radius > 0.52 ? 14 : 12
  let out = ""
  out += circle(radius + 0.035, COLORS.ember, 1.0, 0.38 * opacity)
  out += textRing(rng, radius, id, COLORS.prose, 0.72 * opacity, fontMin, fontMax)
  out += circle(radius - 0.035, COLORS.emberBright, 0.9, 0.36 * opacity)
  return out
}

function symbolNodes(rng: Rng, n: number, radius: number, nodeRadius: number, color: string): string {
  const symbols = Array.from(choice(rng, SYMBOL_SETS))
  const offset = rng() < 0.5 ? 0 : 1 / (2 * n)
  const maxFactor = 2.15 + rng() * 0.70
  const midFactor = 1 + (maxFactor - 1) * (0.42 + rng() * 0.18)
  let pattern: number[]
  if (n % 4 === 0 && rng() < 0.45) {
    pattern = [maxFactor, 1, midFactor, 1]
  } else if (n % 3 === 0 && rng() < 0.55) {
    pattern = [maxFactor, 1, midFactor]
  } else if (n % 2 === 0) {
    pattern = [maxFactor, 1]
  } else {
    pattern = [1 + (maxFactor - 1) * (0.30 + rng() * 0.35)]
  }

  let out = ""
  for (let i = 0; i < n; i += 1) {
    const angle = i / n + offset
    const point = fromPolar(radius, angle)
    const r = nodeRadius * pattern[i % pattern.length]
    out += `<g transform="translate(${point.x.toFixed(2)} ${point.y.toFixed(2)}) rotate(${(angle * 360).toFixed(2)})">`
    out += `<circle class="magic-dot" cx="0" cy="0" r="${(r * HALF).toFixed(2)}" fill="rgba(10,5,6,.72)" stroke="${color}" stroke-width="1.4"/>`
    out += `<text class="magic-symbol" x="0" y="${(r * HALF * 0.32).toFixed(2)}" fill="${COLORS.prose}" text-anchor="middle" font-family="Segoe UI Symbol, serif" font-size="${(r * HALF * 0.68).toFixed(1)}">${choice(rng, symbols)}</text>`
    out += "</g>"
  }
  return out
}

function coreGlyph(rng: Rng): string {
  const variant = randInt(rng, 0, 8)
  const outer = 0.092 + rng() * 0.052
  const inner = outer * (0.42 + rng() * 0.28)
  let out = ""

  if (variant === 0) {
    out += circle(outer, COLORS.emberBright, 1.35, 0.9)
    out += circle(inner, COLORS.ember, 0.9, 0.6)
    const s = 10 + rng() * 8
    out += `<rect x="${(HALF - s / 2).toFixed(2)}" y="${(HALF - s / 2).toFixed(2)}" width="${s.toFixed(2)}" height="${s.toFixed(2)}" transform="rotate(45 ${HALF} ${HALF})" fill="${COLORS.emberBright}" opacity=".92"/>`
  } else if (variant === 1) {
    out += solidStar(4, outer * 1.75, inner * 0.62, 0.125, COLORS.emberBright, 1.25, 0.82, "rgba(232,169,72,.08)")
    out += circle(inner * 1.05, COLORS.prose, 1.0, 0.84)
  } else if (variant === 2) {
    out += nGram(rng, 6, 2, outer * 1.45, 0, COLORS.emberBright, 1.15, 0.76)
    out += circle(inner * 1.18, COLORS.emberBright, 1.0, 0.86)
    out += circle(inner * 0.48, COLORS.prose, 0.9, 0.75)
  } else if (variant === 3) {
    out += circle(outer * 1.20, COLORS.ember, 0.9, 0.52)
    out += circle(outer * 0.84, COLORS.emberBright, 1.25, 0.86)
    out += circle(outer * 0.40, COLORS.prose, 0.9, 0.82)
  } else if (variant === 4) {
    const s = 16 + rng() * 10
    out += `<rect x="${(HALF - s / 2).toFixed(2)}" y="${(HALF - s / 2).toFixed(2)}" width="${s.toFixed(2)}" height="${s.toFixed(2)}" transform="rotate(45 ${HALF} ${HALF})" fill="rgba(232,169,72,.10)" stroke="${COLORS.emberBright}" stroke-width="1.25" opacity=".9"/>`
    out += circle(outer * 0.86, COLORS.ember, 0.8, 0.55)
  } else if (variant === 5) {
    out += nGram(rng, 3, 1, outer * 1.32, rng() / 3, COLORS.emberBright, 1.3, 0.78)
    out += nGram(rng, 3, 1, outer * 0.95, rng() / 3 + 1 / 6, COLORS.ember, 0.9, 0.55)
    out += circle(inner * 0.82, COLORS.prose, 0.8, 0.78)
  } else if (variant === 6) {
    out += `<ellipse cx="${HALF}" cy="${HALF}" rx="${(outer * HALF * 1.12).toFixed(2)}" ry="${(outer * HALF * 0.46).toFixed(2)}" fill="none" stroke="${COLORS.emberBright}" stroke-width="1.2" opacity=".82"/>`
    const s = 8 + rng() * 7
    out += `<rect x="${(HALF - s / 2).toFixed(2)}" y="${(HALF - s / 2).toFixed(2)}" width="${s.toFixed(2)}" height="${s.toFixed(2)}" transform="rotate(45 ${HALF} ${HALF})" fill="${COLORS.prose}" opacity=".78"/>`
  } else {
    const s1 = 17 + rng() * 12
    const s2 = s1 * 0.62
    out += `<rect x="${(HALF - s1 / 2).toFixed(2)}" y="${(HALF - s1 / 2).toFixed(2)}" width="${s1.toFixed(2)}" height="${s1.toFixed(2)}" transform="rotate(45 ${HALF} ${HALF})" fill="none" stroke="${COLORS.emberBright}" stroke-width="1.15" opacity=".85"/>`
    out += `<rect x="${(HALF - s2 / 2).toFixed(2)}" y="${(HALF - s2 / 2).toFixed(2)}" width="${s2.toFixed(2)}" height="${s2.toFixed(2)}" transform="rotate(0 ${HALF} ${HALF})" fill="rgba(232,169,72,.12)" stroke="${COLORS.prose}" stroke-width=".9" opacity=".75"/>`
  }
  return out
}

export function generateMagicCircle(seed?: number): MagicCircleSvg {
  const normalizedSeed = normalizeSeed(seed)
  const rng = mulberry32(normalizedSeed)
  const id = `magicTextCircle${normalizedSeed}`
  const outerN = randInt(rng, 12, 23)
  const outerStep = randInt(rng, 3, Math.min(7, Math.floor(outerN / 2)) + 1)
  const innerN = randInt(rng, 5, 10)
  const innerStep = randInt(rng, 2, Math.max(3, Math.ceil(innerN / 2)))
  const nodeN = randInt(rng, 5, 9)

  let outer = ""
  outer += circle(0.91, COLORS.ember, 1.4, 0.48, "magic-ring-weak")
  outer += circle(0.86, COLORS.emberBright, 2.0, 0.72)
  outer += rng() < 0.52
    ? nGram(rng, outerN, outerStep, 0.84, rng() / outerN, COLORS.emberBright, 1.45, 0.75)
    : arcGram(outerN, Math.max(1, outerStep - 1), 0.84, rng() * 1.4 + 1.4, rng() / outerN, COLORS.emberBright, 1.35, 0.78)
  outer += solidStar(randInt(rng, 18, 32), 0.80, 0.76, rng(), COLORS.ember, 0.7, 0.34)

  let text = ""
  const ringCount = randInt(rng, 1, 3)
  const ringSlots = [
    0.76 + rng() * 0.035,
    0.61 + rng() * 0.055,
    0.43 + rng() * 0.060,
  ]
  for (let i = ringSlots.length - 1; i > 0; i -= 1) {
    const j = randInt(rng, 0, i + 1)
    ;[ringSlots[i], ringSlots[j]] = [ringSlots[j], ringSlots[i]]
  }
  const textRadii = ringSlots.slice(0, ringCount).sort((a, b) => b - a)
  textRadii.forEach((radius, index) => {
    text += textRingLayer(rng, radius, `${id}_${index}`, index === 0 ? 1 : 0.82)
  })

  let inner = ""
  inner += rng() < 0.5
    ? nGram(rng, innerN, innerStep, 0.46, rng() / innerN, COLORS.emberBright, 1.8, 0.78)
    : arcGram(innerN + randInt(rng, 2, 8), Math.max(1, innerStep), 0.46, rng() * 1.1 + 1.1, rng(), COLORS.emberBright, 1.45, 0.72)
  inner += solidStar(nodeN, 0.34, 0.16 + rng() * 0.06, rng() / nodeN, COLORS.blood, 1.15, 0.55)
  inner += symbolNodes(rng, nodeN, 0.47, 0.033 + rng() * 0.010, COLORS.ember)
  inner += circle(0.28, COLORS.whisper, 0.9, 0.45)

  const core = coreGlyph(rng)

  return {
    viewBox: `0 0 ${SIZE} ${SIZE}`,
    layers: `
      <g class="magic-layer magic-layer--outer">${outer}</g>
      <g class="magic-layer magic-layer--text">${text}</g>
      <g class="magic-layer magic-layer--inner">${inner}</g>
      <g class="magic-layer magic-layer--core">${core}</g>
    `,
  }
}
