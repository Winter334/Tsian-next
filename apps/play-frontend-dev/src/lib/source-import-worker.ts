import WorkerCtor from "./source-import.worker.ts?worker"
import type { BuildInput, BuildSourceCorpusProgress, BuiltSourceCorpus } from "./source"

interface SourceImportProgressMessage {
  type: "progress"
  id: string
  progress: BuildSourceCorpusProgress
}

interface SourceImportCompleteMessage {
  type: "complete"
  id: string
  corpus: BuiltSourceCorpus
}

interface SourceImportErrorMessage {
  type: "error"
  id: string
  message: string
}

type SourceImportWorkerMessage = SourceImportProgressMessage | SourceImportCompleteMessage | SourceImportErrorMessage

function nextWorkerRequestId(): string {
  return `source-import-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function buildSourceCorpusInWorker(
  input: BuildInput,
  onProgress?: (progress: BuildSourceCorpusProgress) => void,
): Promise<BuiltSourceCorpus> {
  const worker = new WorkerCtor({ name: "source-import" })
  const id = nextWorkerRequestId()

  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      worker.onmessage = null
      worker.onerror = null
      worker.terminate()
    }

    worker.onmessage = (event: MessageEvent<SourceImportWorkerMessage>) => {
      const message = event.data
      if (!message || message.id !== id) return
      if (message.type === "progress") {
        onProgress?.(message.progress)
        return
      }
      if (message.type === "complete") {
        cleanup()
        resolve(message.corpus)
        return
      }
      cleanup()
      reject(new Error(message.message || "导入失败"))
    }

    worker.onerror = (event) => {
      cleanup()
      reject(new Error(event.message || "导入 Worker 执行失败"))
    }

    worker.postMessage({ id, input })
  })
}
