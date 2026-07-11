/**
 * lib/frontier-types.ts — frontier.json / timeline 锚点类型契约。
 *
 * 对齐：
 * - `save/playthrough/frontier.json` 默认模板
 *   （apps/platform-web/src/storage/workspace-templates.ts 种子 + schema 文档）
 * - task 07-08 design.md §2 timeline 数据模型
 *
 * timeline 锚点用 `kind` 区分 source（world-architect 推进时建）与 player
 * （stage-manager 维护时追加）。`order` 是共享线性轴上的单调递增整数，
 * 与原著精确时间标记无关。`alignment` + `sourceRef` 编码分支的分叉/并回关系。
 *
 * 本文件只出类型，不创渲染组件。类型仅在远程前端源码内使用，
 * 不上升到 @tsian/contracts（与 07-08 R9 的"frontier 概念不进入平台 contracts"一致）。
 */

/** source 锚点：world-architect 推进 frontier 时建立，标记原著剧情节点。 */
export interface SourceAnchor {
  kind: "source"
  /** 单调递增整数，world-architect 赋值。线性轴坐标，与原著时间标记无关。 */
  order: number
  /** 原著章节号，与 sourceWindow 同一坐标。 */
  chapter: number
  /** 游戏时间字符串（可估计，给玩家/场记参考）。 */
  time: string
  /** 一句话客观标签，不是剧情摘要。 */
  label: string
}

/** player 锚点：stage-manager 维护时追加，标记玩家视角显著事件。 */
export interface PlayerAnchor {
  kind: "player"
  /** = 玩家当前所在 source 区间的起始 source order。同一区间多个 player 锚点共享 order。 */
  order: number
  /** 游戏回合号（分支内排序 + 后续精确找 turn 正文）。 */
  turn: number
  /** 游戏时间字符串（显示用）。 */
  time: string
  /** 一句话客观描述。 */
  label: string
  /** 与原著的关系：diverged=偏离，rejoined=并回主干，aligned=经历 source 事件且结果相近（可选）。 */
  alignment: "diverged" | "rejoined" | "aligned"
  /** 关联的 source order。diverged=分叉自的 source order 或 null（原创区间）；rejoined=并回的 source order；aligned=该 source order。 */
  sourceRef: number | null
}

/** timeline 锚点联合类型。 */
export type TimelineAnchor = SourceAnchor | PlayerAnchor

/** frontier.json 结构。 */
export interface Frontier {
  /** 已读章节窗口。start/end 为章节号（闭区间）；chapters 为窗口章节元信息。 */
  sourceWindow: {
    start: number | null
    end: number | null
    chapters?: Array<{ index: number; title: string; path: string }>
  }
  /** 已抽取到的最远章节文件路径。 */
  extractedThrough: string | null
  /** 时间标记锚点数组。 */
  timeline: TimelineAnchor[]
  /** 抽取进度备注。 */
  notes?: string
  /** 维护时间戳。 */
  updatedAt?: string
  /** 维护者。 */
  updatedBy?: string
}

/** useFrontier 返回的数据形态。读取失败时 frontier 为 null、error 非 null。 */
export interface FrontierData {
  /** frontier.json 解析结果；读取失败为 null。 */
  frontier: Frontier | null
  /** 读取级错误（非解析级）；null 表示读取成功。 */
  error: "load-failed" | "not-found" | null
  /** 加载状态：idle/loading/ready/error。 */
  status: "idle" | "loading" | "ready" | "error"
}

/** 初始 idle FrontierData。 */
export function initialFrontierData(): FrontierData {
  return { frontier: null, error: null, status: "idle" }
}
