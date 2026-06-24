import { resolveEmbeddingConfig } from "@/config/ai"

/**
 * semantic-index embedding-client — 远程 embedding API 调用.
 *
 * MVP 只支持 openai-compatible 协议:`POST {baseUrl}/embeddings`,
 * body `{model, input: string[]}`,响应 `data[].embedding`,
 * auth `Authorization: Bearer {apiKey}`. 非 openai-compatible 协议(Gemini 原生
 * `:embedContent` 等)用到再加,不为它预留骨架.
 *
 * 远程 API 的热路径风险:save-runtime 每轮落盘 raw turn 时若同步等 embedding,
 * 网络延迟/失败会阻塞 turn 收尾. 本 client 不做排队/重试——排队归 embed-queue,
 * 重试策略("失败丢 job,下次 staleness 补")也归 embed-queue. 这里只做单次调用.
 */

/** embedding API 响应的最小形状(openai-compatible). */
interface OpenAiEmbeddingResponse {
  data: Array<{ embedding: number[] }>
}

/**
 * 把若干文本嵌入为向量. 调用方负责 catch:`resolveEmbeddingConfig()` 返回 null
 * 或网络/维度错误时,本函数 throw,调用方(embed-queue/search)catch 后返回空/
 * 丢 job,不抛错给 agent.
 *
 * @throws Error 当 embeddingConfig 未配全(resolveEmbeddingConfig 返回 null),
 *               或网络失败,或响应维度与 config.dimensions 不一致.
 */
export async function embed(texts: string[]): Promise<Float32Array[]> {
  const config = resolveEmbeddingConfig()
  if (!config) {
    throw new Error("embedding 配置未生效(resolveEmbeddingConfig 返回 null).")
  }

  if (texts.length === 0) {
    return []
  }

  const url = `${config.baseUrl.replace(/\/+$/, "")}/embeddings`
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({ model: config.model, input: texts }),
  })

  if (!response.ok) {
    const payload = await readJsonPayload(response).catch(() => null)
    const message = extractErrorMessage(payload) ?? `embedding API 失败,HTTP ${response.status}.`
    throw new Error(message)
  }

  const payload = (await response.json()) as OpenAiEmbeddingResponse
  if (!payload?.data || !Array.isArray(payload.data)) {
    throw new Error("embedding API 响应缺少 data 数组.")
  }

  if (payload.data.length !== texts.length) {
    throw new Error(
      `embedding API 返回向量数(${payload.data.length})与输入文本数(${texts.length})不一致.`,
    )
  }

  const vectors: Float32Array[] = []
  for (const entry of payload.data) {
    const raw = entry?.embedding
    if (!Array.isArray(raw) || raw.length !== config.dimensions) {
      throw new Error(
        `embedding API 返回维度(${Array.isArray(raw) ? raw.length : "非数组"})与配置 dimensions(${config.dimensions})不一致.`,
      )
    }
    vectors.push(Float32Array.from(raw))
  }
  return vectors
}

async function readJsonPayload(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function extractErrorMessage(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) {
    return undefined
  }
  const error = (payload as { error?: unknown }).error
  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message
    return typeof message === "string" ? message : undefined
  }
  if (typeof error === "string") {
    return error
  }
  return undefined
}
