import type { ArchiveRecord } from "@tsian/contracts"
import { localDb, type LocalEmbeddingRecord, type LocalEventRecord } from "./db"

export interface EmbeddingSourceRecord {
  targetType: "event" | "archive"
  targetId: string
  content: string
}

export interface EmbeddingMatchRecord extends EmbeddingSourceRecord {
  score: number
}

function contentHash(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

function embeddingId(input: {
  targetType: "event" | "archive"
  targetId: string
  embeddingModel: string
}): string {
  return `${input.embeddingModel}:${input.targetType}:${input.targetId}`
}

function dot(left: number[], right: number[]): number {
  return left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0)
}

function magnitude(vector: number[]): number {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
}

function cosineSimilarity(left: number[], right: number[]): number {
  const divisor = magnitude(left) * magnitude(right)
  return divisor > 0 ? dot(left, right) / divisor : 0
}

export function eventEmbeddingContent(event: LocalEventRecord): string {
  return [
    `时间：${event.time}`,
    `状态：${event.status}`,
    `相关实体：${event.entityTags.join("、")}`,
    `事件：${event.content}`,
  ].join("\n")
}

export function archiveEmbeddingContent(archive: ArchiveRecord): string {
  return [
    `类型：${archive.type}`,
    `名称：${archive.name}`,
    archive.aliases.length > 0 ? `别名：${archive.aliases.join("、")}` : "",
    `背景：${archive.background}`,
    `现状：${archive.situation}`,
    archive.focus ? `关注点：${archive.focus}` : "",
    archive.linkedNames.length > 0 ? `关联实体：${archive.linkedNames.join("、")}` : "",
  ]
    .filter(Boolean)
    .join("\n")
}

export async function getMissingEmbeddingSources(input: {
  sources: EmbeddingSourceRecord[]
  embeddingModel: string
}): Promise<EmbeddingSourceRecord[]> {
  const result: EmbeddingSourceRecord[] = []
  for (const source of input.sources) {
    const id = embeddingId({ ...source, embeddingModel: input.embeddingModel })
    const current = await localDb.embeddings.get(id)
    if (!current || current.contentHash !== contentHash(source.content)) {
      result.push(source)
    }
  }
  return result
}

export async function putEmbeddingVectors(input: {
  sources: EmbeddingSourceRecord[]
  embeddingModel: string
  vectors: number[][]
}): Promise<void> {
  const now = Date.now()
  await Promise.all(
    input.sources.map((source, index) => {
      const record: LocalEmbeddingRecord = {
        id: embeddingId({ ...source, embeddingModel: input.embeddingModel }),
        targetType: source.targetType,
        targetId: source.targetId,
        embeddingModel: input.embeddingModel,
        contentHash: contentHash(source.content),
        vector: input.vectors[index] ?? [],
        updatedAt: now,
      }
      return localDb.embeddings.put(record)
    }),
  )
}

export async function findSimilarEmbeddingSources(input: {
  sources: EmbeddingSourceRecord[]
  embeddingModel: string
  queryVector: number[]
  targetType: "event" | "archive"
  limit: number
  minScore: number
}): Promise<EmbeddingMatchRecord[]> {
  const rows = await Promise.all(
    input.sources
      .filter((source) => source.targetType === input.targetType)
      .map(async (source) => {
        const current = await localDb.embeddings.get(
          embeddingId({ ...source, embeddingModel: input.embeddingModel }),
        )
        if (!current || current.contentHash !== contentHash(source.content)) {
          return null
        }
        const score = cosineSimilarity(input.queryVector, current.vector)
        return score >= input.minScore ? { ...source, score } : null
      }),
  )

  return rows
    .filter((item): item is EmbeddingMatchRecord => item !== null)
    .sort((left, right) => right.score - left.score)
    .slice(0, input.limit)
}
