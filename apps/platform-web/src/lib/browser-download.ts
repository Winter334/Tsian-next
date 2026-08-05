/** Deliver a generated Blob through a trusted presentation click and release all DOM/URL resources. */
export function downloadBrowserBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  let link: HTMLAnchorElement | null = null
  try {
    link = document.createElement("a")
    link.href = url
    link.download = filename
    link.rel = "noopener"
    document.body.appendChild(link)
    link.click()
  } finally {
    link?.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}
