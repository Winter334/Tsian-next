import type { RuntimeSnapshotShell } from "@tsian/contracts"
import {
  localDb,
  type LocalArchiveRecord,
  type LocalEventRecord,
  type LocalSaveHistoryRecord,
  type LocalSaveRecord,
  type LocalSaveSnapshotRecord,
} from "./db"
import { createArchiveId, deleteArchivesForSave } from "./archives"
import { deleteEventsForSave } from "./events"

const ACTIVE_SAVE_KEY = "active-save-id"

interface InitialSavePayload {
  snapshot: RuntimeSnapshotShell
  history: Array<{
    role: string
    content: string
  }>
  events: Array<Omit<LocalEventRecord, "id" | "saveId" | "updatedAt">>
  archives: InitialArchiveRecord[]
}

type InitialArchiveRecord = Pick<
  LocalArchiveRecord,
  | "kind"
  | "name"
  | "aliases"
  | "background"
  | "situation"
  | "focus"
  | "linkedNames"
  | "presence"
> & Record<string, unknown>

function createInitialSnapshot(now: number): RuntimeSnapshotShell {
  return {
    version: "0.0.0",
    state: {
      turn: 3,
      currentTime: offsetIso(now, 0),
      globals: {
        场所: "落云宗经阁",
        焦点: "校正偏星轨迹并确认黑铁匣开启方式",
        风险: "高",
        同行: "白沙",
      },
      messages: [
        {
          role: "user",
          content: "先把昨夜从断云崖带回来的黑铁匣放到灯下，我要重新看一遍外壁暗纹。",
        },
        {
          role: "assistant",
          content:
            "白沙把黑铁匣推到经阁案上，顺手掩上窗扇，提醒你楼下还留着巡夜弟子。匣壁那层冷黑金属在灯下浮出细密纹路，确实和昨夜断云崖血迹旁见到的一样，有一道新鲜裂痕从锁鼻一直斜劈到匣角。",
        },
        {
          role: "user",
          content: "把前日在观星台找到的星图残页也摊开，我想对照它和匣纹是不是同一套笔路。",
        },
        {
          role: "assistant",
          content:
            "白沙从袖中取出那页星图残页压在匣旁。残页边缘沾着旧灰，中央那道偏星轨迹与黑铁匣外壁的弧线几乎能严丝合缝地接上，只差匣底一小段缺口还对不上。",
        },
        {
          role: "user",
          content: "再把《沉星录》翻到卷末，我记得那里提过匣启则星沉的句子。",
        },
        {
          role: "assistant",
          content:
            "经阁旧卷被你们摊开在一旁，卷末那段朱砂批注再次露了出来。白沙压低声音念给你听，说若要开匣，必须先校正残页上的偏星轨迹，否则匣中的东西会把追踪者一路引到落云宗腹地。",
        },
      ],
    },
  }
}

function offsetIso(now: number, offsetMs: number): string {
  return new Date(now + offsetMs).toISOString()
}

function getMessagesFromSnapshot(
  snapshot: RuntimeSnapshotShell,
): Array<{ role: string; content: string }> {
  const rawMessages = snapshot.state.messages
  if (!Array.isArray(rawMessages)) {
    return []
  }

  return rawMessages.flatMap((item) => {
    if (
      typeof item === "object" &&
      item !== null &&
      typeof (item as { role?: unknown }).role === "string" &&
      typeof (item as { content?: unknown }).content === "string"
    ) {
      return [
        {
          role: (item as { role: string }).role,
          content: (item as { content: string }).content,
        },
      ]
    }

    return []
  })
}

function createInitialSavePayload(now: number): InitialSavePayload {
  const snapshot = createInitialSnapshot(now)
  const events: InitialSavePayload["events"] = [
      {
        time: offsetIso(now, -1000 * 60 * 60 * 110),
        status: "done",
        entityTags: ["沈秋水", "回雪渡", "潮音骨哨", "九曲会"],
        content:
          "更早些时候，沈秋水曾在回雪渡借潮音骨哨与九曲会的线人接头，双方谈的都是沿河货路、渡口暗税和几条旧船线的归属。",
      },
      {
        time: offsetIso(now, -1000 * 60 * 60 * 93),
        status: "done",
        entityTags: ["沈秋水", "回雪渡", "九曲会"],
        content:
          "回雪渡那次风暴之后，沈秋水替九曲会临时稳住了渡口秩序，还顺手压下了一场船帮械斗，随后重新分配了几处夜泊船位。",
      },
      {
        time: offsetIso(now, -1000 * 60 * 60 * 76),
        status: "done",
        entityTags: ["沈秋水", "潮音骨哨", "回雪渡"],
        content:
          "沈秋水后来把潮音骨哨封回木匣，不再在回雪渡公开使用，只留下最亲近的两名旧部知道那支骨哨真正的召集方式。",
      },
      {
        time: offsetIso(now, -1000 * 60 * 60 * 64),
        status: "done",
        entityTags: ["余见山", "封河镇", "赤砂路引", "巡砂司"],
        content:
          "六十多个时辰前，余见山持赤砂路引从封河镇出关，替巡砂司押送一批边地文书，沿途查过三处沙路哨口与两本驿站册子。",
      },
      {
        time: offsetIso(now, -1000 * 60 * 60 * 51),
        status: "done",
        entityTags: ["余见山", "巡砂司", "封河镇"],
        content:
          "巡砂司在封河镇外临时加了一道夜哨，余见山奉命留下协助整顿驿站册子，重新核对了商旅路引和三队夜行驼队的出入时辰。",
      },
      {
        time: offsetIso(now, -1000 * 60 * 60 * 33),
        status: "done",
        entityTags: ["余见山", "赤砂路引", "封河镇"],
        content:
          "余见山把那枚赤砂路引重新盖印后收回腰封，准备次日离开封河镇返回北面沙路，顺便把拖欠了半月的驿站木牌一并交割清楚。",
      },
      {
        time: offsetIso(now, -1000 * 60 * 60 * 58),
        status: "done",
        entityTags: ["白沙", "落云宗", "经阁", "冬试名录"],
        content:
          "两日前清晨，白沙曾在经阁独自核对冬试名录，把三名外门弟子的去留批注重新改过，还顺手抽走了一页写满借阅登记的附纸。",
      },
      {
        time: offsetIso(now, -1000 * 60 * 60 * 21),
        status: "done",
        entityTags: ["白沙", "落云宗", "演武坪"],
        content:
          "昨日下午，白沙在演武坪临时叫停了一场外门比试，原因是两名弟子为争用演阵旗位当众动手。她当场罚人去抄宗规，直到傍晚才散。",
      },
      {
        time: offsetIso(now, -1000 * 60 * 60 * 72),
        status: "done",
        entityTags: ["白沙", "落云宗", "观星台", "乌铜司南", "星图残页", "黑铁匣"],
        content:
          "三日前深夜，你与白沙在落云宗观星台借乌铜司南推演偏星轨迹，从一处碎裂石匣底部找到了星图残页。残页角标与黑铁匣外壁暗纹同源，这才让你们意识到两者并非孤立之物。",
      },
      {
        time: offsetIso(now, -1000 * 60 * 60 * 42),
        status: "done",
        entityTags: ["白沙", "经阁", "萧烬", "洗剑池"],
        content:
          "前日傍晚，你与白沙在经阁核对洗剑池账簿时发现萧烬动过宗门药材记录。那页被抽换过的附纸虽然没留下明确去向，却让你们确认宗门内部确有人持续清理与偏星轨迹有关的痕迹。",
      },
      {
        time: offsetIso(now, -1000 * 60 * 60 * 12),
        status: "done",
        entityTags: ["白沙", "断云崖", "黑铁匣", "萧烬", "裂月箭簇"],
        content:
          "昨夜子时，白沙在断云崖截住一名试图转移秘匣的内门弟子，从崖底血迹旁强行夺回黑铁匣。萧烬只在远处出手试探，留下半枚裂月箭簇后便立刻退走，没有与你们正面缠斗。",
      },
      {
        time: offsetIso(now, -1000 * 60 * 60 * 3),
        status: "done",
        entityTags: ["白沙", "经阁", "沉星录", "黑铁匣", "星图残页"],
        content:
          "入阁之前，你与白沙翻出了经阁旧卷《沉星录》，在卷末朱砂批注中看到一句关于黑铁匣的警告：若不开匣前先校正星图残页上的偏星轨迹，匣中之物会主动牵动追踪者的感应。",
      },
      {
        time: offsetIso(now, 0),
        status: "ongoing",
        entityTags: ["白沙", "落云宗", "经阁", "黑铁匣", "星图残页", "沉星录"],
        content:
          "今日清晨，你与白沙留在落云宗经阁内重新检查昨夜从断云崖带回的黑铁匣，把星图残页和《沉星录》一并摊在案上，想确认开匣顺序与匣中之物是否会进一步暴露你们的行踪。",
      },
  ]
  const archives: InitialSavePayload["archives"] = [
      {
        kind: "character:person",
        name: "白沙",
        aliases: ["白宗主"],
        background: "落云宗内地位极高的人物，与你私下合作调查宗门内部与偏星轨迹有关的异动。",
        situation: "正与你一同留在经阁检查黑铁匣、星图残页和《沉星录》，对外仍维持若无其事的姿态。",
        focus: "确认开匣顺序、压住宗门内部的异动，并提防萧烬再次插手。",
        linkedNames: ["落云宗", "经阁", "黑铁匣", "星图残页"],
        presence: "foreground",
      },
      {
        kind: "character:person",
        name: "萧烬",
        aliases: ["萧执令"],
        background: "落云宗内负责肃清痕迹和执行暗令的人物，行事谨慎，很少留下正面证据。",
        situation: "昨夜在断云崖短暂现身后已经退走，但你与白沙都认为他没有真正放弃黑铁匣。",
        focus: "继续追踪黑铁匣的去向，或抢在你们之前处理掉与偏星轨迹有关的证据。",
        linkedNames: ["落云宗", "断云崖", "裂月箭簇"],
        presence: "background",
      },
      {
        kind: "character:person",
        name: "沈秋水",
        aliases: [],
        background: "长期活动在河路一带的人物，与九曲会维持着若即若离的合作关系。",
        situation: "最近仍在回雪渡附近处理渡口与船帮的事务，主要精力都放在恢复渡口秩序和稳住旧部人手上。",
        focus: "稳住回雪渡的河上旧线，避免外部势力趁乱侵占她的渡口人脉。",
        linkedNames: ["回雪渡", "潮音骨哨", "九曲会"],
        presence: "background",
      },
      {
        kind: "character:person",
        name: "余见山",
        aliases: [],
        background: "替巡砂司跑边路的人，熟悉封河镇周边关卡和沙路盘查。",
        situation: "近期一直在封河镇与边路驿站之间来回，处理的是路引、驿册和夜哨调度。",
        focus: "把赤砂路引和巡砂司押送事务办完，尽快把手头几份边路文书顺利交割出去。",
        linkedNames: ["封河镇", "赤砂路引", "巡砂司"],
        presence: "background",
      },
      {
        kind: "organization:faction",
        name: "落云宗",
        aliases: ["天南第一大宗门"],
        background: "天南势力最强的宗门之一，门内藏书、禁器和暗线都极多，表面平静下隐藏着明显的内斗痕迹。",
        situation: "宗门表面仍按旧秩序运转，但与偏星轨迹有关的记录近来正在被人持续清理。",
        focus: "维持表面稳定，同时争夺黑铁匣与残页背后的主动权。",
        linkedNames: ["白沙", "经阁", "观星台"],
        presence: "background",
      },
      {
        kind: "organization:faction",
        name: "九曲会",
        aliases: [],
        background: "盘踞在几处渡口和暗河货路上的松散势力，更关心货流与人脉，不关心宗门秘事。",
        situation: "最近正在回雪渡重新整合被风暴打散的船路秩序，几条夜行船线都在重新分配人手。",
        focus: "守住自己的渡口与货线，避免河上旧部散掉。",
        linkedNames: ["沈秋水", "回雪渡", "潮音骨哨"],
        presence: "background",
      },
      {
        kind: "organization:faction",
        name: "巡砂司",
        aliases: [],
        background: "负责边地沙路巡检、盘查和驿册调度的地方机构。",
        situation: "近来忙于封河镇附近的边路事务，对落云宗内部秘事并不知情。",
        focus: "维持边路秩序与通关盘查，不让私盐和伪造路引继续蔓延。",
        linkedNames: ["余见山", "封河镇", "赤砂路引"],
        presence: "background",
      },
      {
        kind: "location:place",
        name: "经阁",
        aliases: ["落云宗经阁"],
        background: "落云宗用于存放典籍与机密记录的楼阁，重要旧卷和禁录大多封存在这里。",
        situation: "清晨时分灯火未熄，楼下仍有巡夜弟子来回走动，但暂时还没人打扰你与白沙。",
        focus: "作为检查黑铁匣、星图残页和《沉星录》的隐蔽地点继续维持安静。",
        linkedNames: ["落云宗", "白沙", "黑铁匣", "沉星录"],
        presence: "foreground",
      },
      {
        kind: "location:place",
        name: "断云崖",
        aliases: [],
        background: "落云宗外缘险地，常被用来秘密处置见不得光的人和物。",
        situation: "昨夜留下的血迹与打斗痕迹大多已被掩去，但那里仍是黑铁匣最后一次公开现身的地点。",
        focus: "作为后续回查黑铁匣来路和萧烬动向的重要现场继续被关注。",
        linkedNames: ["落云宗", "黑铁匣", "裂月箭簇"],
        presence: "background",
      },
      {
        kind: "location:place",
        name: "观星台",
        aliases: ["北峰观星台"],
        background: "落云宗用于观测天象和推演星轨的高台，平日少有人久留。",
        situation: "三日前你与白沙就是在那里借乌铜司南找到星图残页，此后台上部分痕迹已被清扫。",
        focus: "保留与偏星轨迹和星图残页有关的最早实物线索。",
        linkedNames: ["落云宗", "乌铜司南", "星图残页"],
        presence: "background",
      },
      {
        kind: "location:place",
        name: "回雪渡",
        aliases: [],
        background: "一处以渡船和暗河货路闻名的河口渡头，常年消息杂乱、人流复杂。",
        situation: "最近刚经历过风暴，渡口秩序还在慢慢恢复，夜间泊位和税册都在重新整理。",
        focus: "继续作为河路势力和九曲会活动的主要据点。",
        linkedNames: ["沈秋水", "九曲会", "潮音骨哨"],
        presence: "background",
      },
      {
        kind: "location:place",
        name: "封河镇",
        aliases: [],
        background: "靠近边路关卡的小镇，驿站和盘查哨口密集，来往文书极多。",
        situation: "近期被巡砂司加了夜哨，围绕路引和通关册子的事务正忙。",
        focus: "维持边路通行与盘查秩序，让驿站、哨口和文书流转继续正常运作。",
        linkedNames: ["余见山", "巡砂司", "赤砂路引"],
        presence: "background",
      },
      {
        kind: "location:place",
        name: "洗剑池",
        aliases: [],
        background: "落云宗内负责养护兵刃与清点相关物资的区域，账簿流转频繁，适合藏匿微小但关键的异动痕迹。",
        situation: "前日被你与白沙拿来核对药材与兵器记录，已暴露出萧烬动过账册的异常。",
        focus: "作为宗门内部痕迹被人为清理的一个旁证，后续仍值得回查。",
        linkedNames: ["落云宗", "白沙", "萧烬"],
        presence: "background",
      },
      {
        kind: "location:place",
        name: "演武坪",
        aliases: [],
        background: "落云宗外门弟子日常比试与演阵演练的场地，平日最容易起争执，也最容易被人围观。",
        situation: "昨日下午刚因一场外门比试被白沙临时叫停，地面阵线还没彻底擦净。",
        focus: "继续承担宗门外门演练和比试事务，短时间内大概还会被执事重点盯着整顿。",
        linkedNames: ["白沙", "落云宗"],
        presence: "background",
      },
      {
        kind: "item:object",
        name: "黑铁匣",
        aliases: ["沉星匣"],
        background: "昨夜从断云崖夺回的沉重秘匣，外壁暗纹与星图残页同源，匣体曾被人强行试图撬开。",
        situation: "已被放到经阁案上，锁鼻一侧带着新裂痕，匣中之物尚未被正式开启确认。",
        focus: "确认安全开启方式，并弄清它为何会牵动宗门内部多方势力。",
        linkedNames: ["白沙", "星图残页", "沉星录"],
        presence: "foreground",
      },
      {
        kind: "item:object",
        name: "星图残页",
        aliases: ["残页"],
        background: "三日前在观星台找到的残缺星图，笔路与黑铁匣外壁暗纹高度一致。",
        situation: "正被压在黑铁匣旁与匣纹对照，其中一小段缺口仍对不上。",
        focus: "补足偏星轨迹，作为开匣前的校正依据。",
        linkedNames: ["黑铁匣", "观星台", "沉星录"],
        presence: "foreground",
      },
      {
        kind: "item:object",
        name: "乌铜司南",
        aliases: ["旧司南"],
        background: "你与白沙在观星台借来推演偏星轨迹的旧器物，对异常星路十分敏感。",
        situation: "目前未被带到经阁，但仍是复验残页轨迹时最可靠的外部工具。",
        focus: "必要时再次用于校验残页与黑铁匣之间的对应关系。",
        linkedNames: ["观星台", "星图残页"],
        presence: "background",
      },
      {
        kind: "item:object",
        name: "潮音骨哨",
        aliases: [],
        background: "沈秋水惯用的骨制短哨，平时只用来召集她在河上的旧部。",
        situation: "已经被她重新封回木匣，不再在回雪渡公开使用。",
        focus: "继续作为她调动河上旧部和稳住渡口局面的私用信物。",
        linkedNames: ["沈秋水", "回雪渡", "九曲会"],
        presence: "background",
      },
      {
        kind: "item:object",
        name: "赤砂路引",
        aliases: [],
        background: "边路通关时使用的特制路引，牵涉的都是封河镇和巡砂司的沙路事务。",
        situation: "近期一直被余见山随身带着，刚重新补过印。",
        focus: "继续用于边路通行、验册和几处沙路哨口的临时盘查。",
        linkedNames: ["余见山", "封河镇", "巡砂司"],
        presence: "background",
      },
      {
        kind: "item:object",
        name: "裂月箭簇",
        aliases: [],
        background: "昨夜萧烬撤离时留下的半枚箭簇，材质与普通宗门制式兵器不同，更像是他私下惯用的追踪信物。",
        situation: "目前被你们单独收着，尚未拿去公开比对，以免提前惊动宗门内其他人。",
        focus: "作为把断云崖一战与萧烬直接连起来的重要物证继续保留。",
        linkedNames: ["萧烬", "断云崖"],
        presence: "background",
      },
      {
        kind: "item:object",
        name: "沉星录",
        aliases: ["经阁旧卷"],
        background: "藏在经阁深处的旧卷，卷末朱砂批注明确提到黑铁匣与开匣条件。",
        situation: "此刻就摊在案边，卷末那句关于偏星轨迹的警告正被你与白沙反复核对。",
        focus: "提供开匣顺序与风险提示，避免你们因误判而暴露行踪。",
        linkedNames: ["经阁", "黑铁匣", "星图残页"],
        presence: "foreground",
      },
      {
        kind: "item:object",
        name: "冬试名录",
        aliases: [],
        background: "落云宗为冬试准备的弟子名录，页边批注很多，常被执事和上层人物拿来改动去留。",
        situation: "两日前被白沙在经阁重新核过一遍，其中几页附纸已被抽走另行存放。",
        focus: "继续作为宗门冬试和弟子去留调整时的重要文书，被经阁与执事反复调阅。",
        linkedNames: ["白沙", "经阁", "落云宗"],
        presence: "foreground",
      },
    ]

  return {
    snapshot,
    history: getMessagesFromSnapshot(snapshot),
    // 默认档同时提供过去事件、当前进行中事件和多档案实体，方便直接验收检索链。
    events,
    archives,
  }
}

function createSaveId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }

  return `save-${Date.now()}`
}

export async function listLocalSaves(): Promise<LocalSaveRecord[]> {
  return localDb.saves.orderBy("updatedAt").reverse().toArray()
}

export async function getActiveSaveId(): Promise<string | null> {
  const record = await localDb.meta.get(ACTIVE_SAVE_KEY)
  return record?.value ?? null
}

export async function setActiveSaveId(saveId: string): Promise<void> {
  await localDb.meta.put({
    key: ACTIVE_SAVE_KEY,
    value: saveId,
  })
}

export async function createLocalSave(
  name?: string,
  snapshot?: RuntimeSnapshotShell,
): Promise<LocalSaveRecord> {
  const existing = await localDb.saves.count()
  const now = Date.now()
  const initial: InitialSavePayload = snapshot
    ? {
        snapshot,
        history: getMessagesFromSnapshot(snapshot),
        events: [],
        archives: [],
      }
    : createInitialSavePayload(now)

  const save: LocalSaveRecord = {
    id: createSaveId(),
    name: name?.trim() || `Save ${existing + 1}`,
    createdAt: now,
    updatedAt: now,
  }

  const snapshotRecord: LocalSaveSnapshotRecord = {
    saveId: save.id,
    snapshot: initial.snapshot,
  }

  const historyRecord: LocalSaveHistoryRecord = {
    saveId: save.id,
    messages: initial.history,
  }

  await localDb.transaction(
    "rw",
    localDb.tables,
    async () => {
      await localDb.saves.put(save)
      await localDb.saveSnapshots.put(snapshotRecord)
      await localDb.saveHistory.put(historyRecord)

      for (const [index, event] of initial.events.entries()) {
        const parsedTime = Date.parse(event.time)
        await localDb.events.put({
          id: `${save.id}:event:${now}:${index}`,
          saveId: save.id,
          ...event,
          updatedAt: Number.isFinite(parsedTime) ? parsedTime + index : now + index,
        })
      }

      const reservedArchiveIds = new Set<string>()
      for (const archive of initial.archives) {
        await localDb.archives.put({
          id: await createArchiveId(archive.kind, reservedArchiveIds),
          saveId: save.id,
          ...archive,
          updatedAt: now,
        })
      }
    },
  )

  return save
}

export async function getSnapshotForSave(
  saveId: string,
): Promise<RuntimeSnapshotShell> {
  const record = await localDb.saveSnapshots.get(saveId)
  return record?.snapshot ?? createInitialSnapshot(Date.now())
}

export async function saveSnapshotForSave(
  saveId: string,
  snapshot: RuntimeSnapshotShell,
): Promise<void> {
  const now = Date.now()
  await localDb.transaction("rw", localDb.saves, localDb.saveSnapshots, async () => {
    await localDb.saveSnapshots.put({
      saveId,
      snapshot,
    })

    const save = await localDb.saves.get(saveId)
    if (save) {
      await localDb.saves.put({
        ...save,
        updatedAt: now,
      })
    }
  })
}

export async function deleteLocalSave(saveId: string): Promise<void> {
  await localDb.transaction(
    "rw",
    localDb.saves,
    localDb.saveSnapshots,
    localDb.saveHistory,
    async () => {
      await localDb.saves.delete(saveId)
      await localDb.saveSnapshots.delete(saveId)
      await localDb.saveHistory.delete(saveId)
    },
  )

  await deleteEventsForSave(saveId)
  await deleteArchivesForSave(saveId)
}

export async function getHistoryForSave(
  saveId: string,
): Promise<Array<{ role: string; content: string }>> {
  const record = await localDb.saveHistory.get(saveId)
  return record?.messages ?? []
}

export async function saveHistoryForSave(
  saveId: string,
  messages: Array<{ role: string; content: string }>,
): Promise<void> {
  await localDb.saveHistory.put({
    saveId,
    messages,
  })
}
