import { unzipSync } from "fflate"

let legacyZipPathDecoder: TextDecoder | null | undefined
const UTF8_PATH_DECODER = new TextDecoder("utf-8", { fatal: true })

const WINDOWS_1252_REVERSE_BYTES: Record<number, number> = {
  0x20AC: 0x80,
  0x201A: 0x82,
  0x0192: 0x83,
  0x201E: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02C6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8A,
  0x2039: 0x8B,
  0x0152: 0x8C,
  0x017D: 0x8E,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201C: 0x93,
  0x201D: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02DC: 0x98,
  0x2122: 0x99,
  0x0161: 0x9A,
  0x203A: 0x9B,
  0x0153: 0x9C,
  0x017E: 0x9E,
  0x0178: 0x9F,
}

function getLegacyZipPathDecoder(): TextDecoder | null {
  if (legacyZipPathDecoder !== undefined) {
    return legacyZipPathDecoder
  }
  try {
    legacyZipPathDecoder = new TextDecoder("gb18030", { fatal: true })
  } catch {
    legacyZipPathDecoder = null
  }
  return legacyZipPathDecoder
}

function decodeCjkPath(bytes: Uint8Array, decoder: TextDecoder | null): string | null {
  if (!decoder) {
    return null
  }
  try {
    const decoded = decoder.decode(bytes)
    return /[\u3400-\u9FFF]/.test(decoded) && !decoded.includes("\uFFFD") ? decoded : null
  } catch {
    return null
  }
}

function bytesFromLatin1Path(path: string): Uint8Array | null {
  const bytes = new Uint8Array(path.length)
  for (let index = 0; index < path.length; index += 1) {
    const code = path.charCodeAt(index)
    if (code > 0xFF) {
      return null
    }
    bytes[index] = code
  }
  return bytes
}

function bytesFromWindows1252Path(path: string): Uint8Array | null {
  const bytes = new Uint8Array(path.length)
  for (let index = 0; index < path.length; index += 1) {
    const code = path.charCodeAt(index)
    const mapped = WINDOWS_1252_REVERSE_BYTES[code]
    if (mapped !== undefined) {
      bytes[index] = mapped
      continue
    }
    if (code <= 0xFF) {
      bytes[index] = code
      continue
    }
    return null
  }
  return bytes
}

/**
 * Some ZIP producers store Chinese filenames without setting the ZIP UTF-8 flag.
 * `fflate` then exposes the raw bytes as a Latin-1 string, which renders as
 * mojibake such as `»îÈË¸Ð`. Repair only when the path still looks byte-shaped
 * and decoding those bytes produces CJK text.
 */
export function repairLegacyZipPathEncoding(path: string): string {
  if (/^[\x00-\x7F]*$/.test(path) || /[\u3400-\u9FFF]/.test(path)) {
    return path
  }
  if (!/[\u0080-\u00FF]{2}/.test(path)) {
    return path
  }

  const latin1Bytes = bytesFromLatin1Path(path)
  const windows1252Bytes = bytesFromWindows1252Path(path)

  const byteVariants = [latin1Bytes, windows1252Bytes].filter((bytes): bytes is Uint8Array => Boolean(bytes))

  for (const bytes of byteVariants) {
    const repaired = decodeCjkPath(bytes, UTF8_PATH_DECODER)
    if (repaired) {
      return repaired
    }
  }

  const legacyDecoder = getLegacyZipPathDecoder()
  for (const bytes of byteVariants) {
    const repaired = decodeCjkPath(bytes, legacyDecoder)
    if (repaired) {
      return repaired
    }
  }

  return path
}

/**
 * Unzip with legacy filename repair applied at the boundary, so every consumer
 * downstream sees clean paths without re-running the repair heuristic. This is
 * the single point that fixes GBK/GB18030/UTF-8-without-flag zip entries.
 */
export function unzipSyncRepaired(input: Uint8Array): Record<string, Uint8Array> {
  const entries = unzipSync(input)
  const repaired: Record<string, Uint8Array> = {}
  for (const path in entries) {
    const repairedPath = repairLegacyZipPathEncoding(path)
    if (repairedPath in repaired) {
      throw new Error(`ZIP entry path collision after encoding repair: ${repairedPath}`)
    }
    repaired[repairedPath] = entries[path]
  }
  return repaired
}
