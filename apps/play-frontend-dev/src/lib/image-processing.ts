/**
 * lib/image-processing.ts — 上传头像图片处理纯函数（验证 + 解码 + 等比缩放 + WebP 导出）。
 *
 * task 07-24 R7：
 * - 支持 png/jpg/webp，源文件大小上限 5MB。
 * - 解码（createImageBitmap 优先，Image fallback）。
 * - 保持原始宽高比，最大边缩放至 1024；小图不放大。
 * - canvas.toBlob 导出 image/webp quality 0.9。
 * - 错误返回人类可读中文提示，不抛错。
 */

/** 允许的源文件 MIME 类型。 */
const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"])

/** 源文件大小上限（5MB）。 */
const MAX_FILE_SIZE = 5 * 1024 * 1024

/** WebP 导出质量。 */
const WEBP_QUALITY = 0.9

/** 导出图片最大边长，避免超大图导致 canvas 性能问题。 */
const MAX_EXPORT_DIMENSION = 1024

export type PreparePortraitResult =
  | { blob: Blob; error?: undefined }
  | { error: string }

/**
 * 把上传的图片文件验证、解码、按原始比例缩放至最大边 1024，导出为 WebP Blob。
 *
 * @param file 用户选择的图片文件。
 * @returns 成功返回 `{ blob }`，失败返回 `{ error }`（中文提示，不抛错）。
 */
export async function preparePortraitBlob(file: File): Promise<PreparePortraitResult> {
  // ── MIME 校验 ──
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return { error: "不支持的图片格式，仅支持 PNG / JPG / WebP。" }
  }

  // ── 大小校验 ──
  if (file.size > MAX_FILE_SIZE) {
    return { error: "图片大小超过 5MB 限制。" }
  }

  // ── 解码 ──
  let bitmap: ImageBitmap | HTMLImageElement
  try {
    if (typeof createImageBitmap === "function") {
      bitmap = await createImageBitmap(file)
    } else {
      bitmap = await decodeViaImage(file)
    }
  } catch {
    return { error: "图片解码失败，可能已损坏。" }
  }

  const srcW = bitmap.width
  const srcH = bitmap.height
  if (srcW <= 0 || srcH <= 0) {
    closeDecodedImage(bitmap)
    return { error: "图片尺寸无效。" }
  }

  // ── 计算导出尺寸（保持原始比例，小图不放大） ──
  const scale = Math.min(1, MAX_EXPORT_DIMENSION / Math.max(srcW, srcH))
  const outW = Math.max(1, Math.round(srcW * scale))
  const outH = Math.max(1, Math.round(srcH * scale))

  // ── canvas 绘制 + WebP 导出 ──
  const canvas = document.createElement("canvas")
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext("2d")
  if (!ctx) {
    closeDecodedImage(bitmap)
    return { error: "无法创建画布上下文。" }
  }
  ctx.drawImage(bitmap, 0, 0, srcW, srcH, 0, 0, outW, outH)

  closeDecodedImage(bitmap)

  const blob = await canvasToBlob(canvas)
  if (!blob) {
    return { error: "图片导出失败，浏览器可能不支持 WebP 编码。" }
  }
  return { blob }
}

/** 释放 createImageBitmap 产生的解码资源。 */
function closeDecodedImage(image: ImageBitmap | HTMLImageElement): void {
  if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) image.close()
}

/** 用 Image 元素解码图片（createImageBitmap 不可用时的 fallback）。 */
function decodeViaImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error("Image decode failed"))
    }
    img.src = url
  })
}

/** canvas.toBlob 的 Promise 封装，导出 image/webp。 */
function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob),
      "image/webp",
      WEBP_QUALITY,
    )
  })
}
