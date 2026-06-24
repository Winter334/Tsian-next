import type { WorkspaceScope, WorkspaceFile } from "@tsian/contracts"

import type { LocalEmbeddingIndexRecord } from "@/storage/db"
import { resolveEmbeddingConfig } from "@/config/ai"
import { embed } from "./embedding-client"
import { chunkWorkspaceFile } from "./chunker"
import {
  buildEmbeddingRecordId,
  deleteEmbeddingsByPath,
  upsertEmbeddings,
} from "./index-store"

/**
 * semantic-index embed-queue — 轻量内存异步嵌入队列.
 *
 * 远程 embedding API 的热路径风险:save-runtime 每轮落盘 raw turn 时若同步等
 * embedding,网络延迟/失败会阻塞 turn 收尾. 解耦:turn 落盘即完成(不等 embedding),
 * 向量嵌入异步排队. enqueue 是同步入队(不阻塞 turn),consume 异步消费.
 *
 * 设计取舍:
 * - **串行消费**:一次一个 embedding API 调用,避免并发限制 + 成本突发.
 * - **去重**:同 path 多次变更只保留最新一次嵌入(攒批).
 * - **不持久化**:进程重启丢队列不丢正确性——staleness 兜底会在下次搜索时按需
 *   补嵌. 持久化 job 表是过度设计.
 * - **失败丢 job**:API 失败 → 该 job 丢弃(不重试轰炸),下次 staleness 会重新
 *   发现它 stale 再补.
 * - **背压**:队列过长(>阈值)时丢弃旧 job(staleness 兜底兜得住).
 */

interface EmbedJob {
  scope: WorkspaceScope
  ownerId: string
  path: string
  operation: "embed" | "delete"
  /** embed 需要文件内容(避免 consume 时再读一遍 DB). delete 不用. */
  file?: WorkspaceFile
}

const MAX_QUEUE_SIZE = 500
const EMBED_BATCH_SIZE = 32

class EmbedQueue {
  private jobs = new Map<string, EmbedJob>()
  private consuming = false

  /** 入队. 同 path 去重(只保留最新一次). 队列满时丢旧 job(背压). */
  enqueue(job: EmbedJob): void {
    if (!resolveEmbeddingConfig()) {
      // 能力链关闭:不调 API,不入队(空转). 索引靠 staleness 在下次配置生效后补.
      return
    }
    const key = `${job.scope}:${job.ownerId}:${job.path}`
    this.jobs.set(key, job)
    if (this.jobs.size > MAX_QUEUE_SIZE) {
      // 背压:丢最早入队的一个(Map 保持插入序).
      const oldest = this.jobs.keys().next().value
      if (oldest) {
        this.jobs.delete(oldest)
      }
    }
    void this.consume()
  }

  /** 进程退出/visibilitychange 时尽力 flush(不等异步). */
  flush(): void {
    void this.consume()
  }

  /** 串行消费循环. 一次处理一个 path 的 job(该 path 所有 chunk 一批 embed). */
  private async consume(): Promise<void> {
    if (this.consuming) {
      return
    }
    this.consuming = true
    try {
      while (this.jobs.size > 0 && resolveEmbeddingConfig()) {
        const next = this.jobs.values().next().value
        if (!next) {
          break
        }
        // 先移出队列(失败丢 job,不重试).
        const key = `${next.scope}:${next.ownerId}:${next.path}`
        this.jobs.delete(key)
        try {
          await this.runJob(next)
        } catch {
          // 失败丢 job:staleness 兜底会在下次搜索时重新发现它 stale 再补.
        }
      }
    } finally {
      this.consuming = false
    }
  }

  private async runJob(job: EmbedJob): Promise<void> {
    if (job.operation === "delete") {
      await deleteEmbeddingsByPath(job.scope, job.ownerId, job.path)
      return
    }
    if (!job.file) {
      return
    }
    const chunks = chunkWorkspaceFile(job.file)
    if (chunks.length === 0) {
      // 该文件无可索引语料(如 JSON 状态/损坏 JSON)→ 删旧 chunk(若有)后返回.
      await deleteEmbeddingsByPath(job.scope, job.ownerId, job.path)
      return
    }
    // 分批 embed(API 单次输入量可控),再一次性 upsert.
    const records: LocalEmbeddingIndexRecord[] = []
    for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
      const batch = chunks.slice(i, i + EMBED_BATCH_SIZE)
      const vectors = await embed(batch.map((c) => c.text))
      const config = resolveEmbeddingConfig()
      if (!config) {
        return
      }
      for (let j = 0; j < batch.length; j++) {
        const chunk = batch[j]
        if (!chunk) {
          continue
        }
        const vector = vectors[j]
        if (!vector) {
          continue
        }
        records.push({
          id: buildEmbeddingRecordId(job.scope, job.ownerId, chunk.path, chunk.chunkIndex),
          scope: job.scope,
          ownerId: job.ownerId,
          path: chunk.path,
          chunkIndex: chunk.chunkIndex,
          text: chunk.text,
          vector,
          type: chunk.type,
          ...(chunk.turn !== undefined ? { turn: chunk.turn } : {}),
          ...(chunk.fileCreatedAt !== undefined ? { fileCreatedAt: chunk.fileCreatedAt } : {}),
          fileUpdatedAt: job.file.updatedAt,
          updatedAt: Date.now(),
          model: config.model,
        })
      }
    }
    if (records.length > 0) {
      await upsertEmbeddings(job.scope, job.ownerId, records)
    }
  }
}

/** 单例. 全进程一个队列,串行消费. */
let queueInstance: EmbedQueue | null = null

function getQueue(): EmbedQueue {
  if (!queueInstance) {
    queueInstance = new EmbedQueue()
    // visibilitychange 时尽力 flush(页面切走前把已排队的嵌入跑掉).
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
          getQueue().flush()
        }
      })
    }
  }
  return queueInstance
}

/** 入队嵌入(异步消费,不阻塞). */
export function enqueueEmbed(
  scope: WorkspaceScope,
  ownerId: string,
  file: WorkspaceFile,
): void {
  getQueue().enqueue({ scope, ownerId, path: file.path, operation: "embed", file })
}

/** 入队删除(异步消费). */
export function enqueueDelete(
  scope: WorkspaceScope,
  ownerId: string,
  path: string,
): void {
  getQueue().enqueue({ scope, ownerId, path, operation: "delete" })
}

/** 尽力 flush(visibilitychange / 测试用). */
export function flushEmbedQueue(): void {
  getQueue().flush()
}

/** 重置单例(仅测试用,清除 import 缓存外的状态). */
export function resetEmbedQueueForTests(): void {
  queueInstance = null
}
