export interface DecodedTextFile {
  text: string
  encoding: string
  encodingLabel: string
}

const LEGACY_CHINESE_ENCODINGS = [
  { encoding: "gb18030", label: "GB18030 / GBK" },
  { encoding: "big5", label: "Big5" },
]

function hasPrefix(bytes: Uint8Array, prefix: number[]): boolean {
  if (bytes.length < prefix.length) return false
  return prefix.every((value, index) => bytes[index] === value)
}

function decodeWithEncoding(bytes: Uint8Array, encoding: string, fatal = false): string | null {
  try {
    return new TextDecoder(encoding, { fatal }).decode(bytes)
  } catch {
    return null
  }
}

function isCjkCodePoint(code: number): boolean {
  return (code >= 0x3400 && code <= 0x9FFF)
    || (code >= 0xF900 && code <= 0xFAFF)
    || (code >= 0x20000 && code <= 0x2FA1F)
}

function isChinesePunctuation(code: number): boolean {
  return (code >= 0x3000 && code <= 0x303F)
    || (code >= 0xFF00 && code <= 0xFFEF)
    || code === 0x2014
    || code === 0x2026
}

function scoreDecodedText(text: string): number {
  let score = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code === 0xFFFD) {
      score -= 100
    } else if ((code < 0x20 && code !== 0x09 && code !== 0x0A && code !== 0x0D) || (code >= 0x7F && code <= 0x9F)) {
      score -= 20
    } else if (isCjkCodePoint(code)) {
      score += 3
    } else if (isChinesePunctuation(code)) {
      score += 1
    } else if (code >= 0x20 && code <= 0x7E) {
      score += 0.2
    }
  }
  return score
}

function decodeLegacyChinese(bytes: Uint8Array): DecodedTextFile | null {
  let best: DecodedTextFile | null = null
  let bestScore = Number.NEGATIVE_INFINITY

  for (const candidate of LEGACY_CHINESE_ENCODINGS) {
    const text = decodeWithEncoding(bytes, candidate.encoding, true)
      ?? decodeWithEncoding(bytes, candidate.encoding)
    if (text === null) continue

    const score = scoreDecodedText(text)
    if (score > bestScore) {
      bestScore = score
      best = {
        text,
        encoding: candidate.encoding,
        encodingLabel: candidate.label,
      }
    }
  }

  return best
}

export function decodeTextBytes(bytes: Uint8Array): DecodedTextFile {
  if (hasPrefix(bytes, [0xEF, 0xBB, 0xBF])) {
    return {
      text: decodeWithEncoding(bytes, "utf-8") ?? "",
      encoding: "utf-8",
      encodingLabel: "UTF-8",
    }
  }

  if (hasPrefix(bytes, [0xFF, 0xFE])) {
    return {
      text: decodeWithEncoding(bytes, "utf-16le") ?? "",
      encoding: "utf-16le",
      encodingLabel: "UTF-16 LE",
    }
  }

  if (hasPrefix(bytes, [0xFE, 0xFF])) {
    return {
      text: decodeWithEncoding(bytes, "utf-16be") ?? "",
      encoding: "utf-16be",
      encodingLabel: "UTF-16 BE",
    }
  }

  const utf8 = decodeWithEncoding(bytes, "utf-8", true)
  if (utf8 !== null) {
    return {
      text: utf8,
      encoding: "utf-8",
      encodingLabel: "UTF-8",
    }
  }

  const legacy = decodeLegacyChinese(bytes)
  if (legacy) return legacy

  return {
    text: decodeWithEncoding(bytes, "utf-8") ?? "",
    encoding: "utf-8-replacement",
    encodingLabel: "UTF-8（容错）",
  }
}

export async function readTextFileWithEncoding(file: File): Promise<DecodedTextFile> {
  return decodeTextBytes(new Uint8Array(await file.arrayBuffer()))
}
