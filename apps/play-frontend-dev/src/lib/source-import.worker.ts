import { buildSourceCorpus, type BuildInput, type BuildSourceCorpusProgress } from "./source"

interface SourceImportWorkerRequest {
  id: string
  input: BuildInput
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "导入失败")
}

self.onmessage = (event: MessageEvent<SourceImportWorkerRequest>) => {
  const request = event.data
  if (!request || typeof request.id !== "string") return

  try {
    const corpus = buildSourceCorpus(
      request.input.text,
      {
        title: request.input.title,
        fileName: request.input.fileName,
        sourceFormat: request.input.sourceFormat,
        importMode: request.input.importMode,
      },
      (progress: BuildSourceCorpusProgress) => {
        self.postMessage({ type: "progress", id: request.id, progress })
      },
    )
    self.postMessage({ type: "complete", id: request.id, corpus })
  } catch (error) {
    self.postMessage({ type: "error", id: request.id, message: errorMessage(error) })
  }
}

export {}
