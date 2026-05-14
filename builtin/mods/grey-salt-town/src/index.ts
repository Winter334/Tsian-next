import type { ModInitialSavePayload, ModStaticContent, RuntimeSnapshotShell, WorkflowDefinition } from "@tsian/contracts"

// === 叙事时间锚点（虚构纪元） ===
// 设计原则：叙事时间是纯游戏内字段，不应绑定系统时钟（Date.now()）。
// 当前 ModInitialSavePayload 契约仍透传 now: number（系统时间）作为兜底参数，
// 但本模组完全忽略它，使用硬编码虚构纪元 0001 年作为故事起点。
// 故事"当前"：0001-01-15 23:00（叶临蹲在驿馆后院旧井旁的那个雨夜）。
// 未来契约层会让模组直接声明叙事锚点（独立 OpenSpec change），届时本模组改成完整自决。
const NARRATIVE_ANCHOR_UTC_MS = Date.UTC(1, 0, 15, 23, 0, 0) // 0001-01-15 23:00 UTC

function formatNarrativeTime(utcMs: number): string {
  const date = new Date(utcMs)
  const year = String(date.getUTCFullYear()).padStart(4, "0")
  const month = String(date.getUTCMonth() + 1).padStart(2, "0")
  const day = String(date.getUTCDate()).padStart(2, "0")
  const hour = String(date.getUTCHours()).padStart(2, "0")
  const minute = String(date.getUTCMinutes()).padStart(2, "0")
  return `${year}-${month}-${day} ${hour}:${minute}`
}

function addNarrativeTimeOffset(offsetMs: number): string {
  return formatNarrativeTime(NARRATIVE_ANCHOR_UTC_MS + offsetMs)
}
function createInitialSnapshot(): RuntimeSnapshotShell {
  return {
    version: "0.0.0",
    state: {
      turn: 3,
      currentTime: addNarrativeTimeOffset(0),
      globals: {
        章节: "灰盐镇·雨夜验尸",
        当前地点: "灰盐镇驿馆后院",
        天气: "子夜后，冷雨未停",
        当前目标: "确认驿馆命案、盐仓异响和旧井黑鳞是否有关",
        同行者: ["许砚"],
      },
      messages: [
        {
          role: "user",
          content: "我先让许砚守住后院门，自己蹲下检查尸体袖口和井沿之间的泥水痕迹。",
        },
        {
          role: "assistant",
          content:
            "许砚把后院门闩压住，低声拦下想探头的驿卒。你蹲到尸体旁，冷雨把泥水冲成细线，死者袖口却还沾着一圈干盐，像是先在盐仓里拖过，又被人搬到旧井边。井沿外侧有三枚很浅的爪痕，不像人手，也不像寻常野兽。",
        },
        {
          role: "user",
          content: "我取出青铜验妖铃，先不催动，只把铃口靠近那三枚爪痕，看它有没有自然反应。",
        },
        {
          role: "assistant",
          content:
            "青铜验妖铃刚靠近井沿，铃舌便自己偏向盐仓方向，发出半声闷响。许砚回头看了你一眼，脸色沉了下来，因为那种闷响通常只会出现在妖气被盐、灰或血遮住的时候。爪痕最深处还嵌着一片黑鳞，边缘像被雨水泡软，却没有腐坏。",
        },
        {
          role: "user",
          content: "把黑鳞先夹进油纸袋，再问韩照今晚盐仓有没有人私自开过门。",
        },
        {
          role: "assistant",
          content:
            "你用镊子把黑鳞夹进油纸袋，鳞片离开井沿时，青铜验妖铃终于止住颤动。韩照被许砚带到廊下，他一口咬定盐仓钥匙整晚都在自己腰上，可你注意到他靴底沾着同样的湿盐，右袖还缺了一枚铜扣。",
        },
      ],
    },
  }
}

function formatSeedTime(time: string): string {
  const match = time.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/)
  if (!match) {
    return time
  }

  const [, year, month, day, hour, minute] = match
  return `${year}年${Number(month)}月${Number(day)}日 ${hour}:${minute}`
}

// 临时修复：保留 now 参数以兼容现有 ModInitialSavePayload 契约入口，但本模组完全忽略它，
// 所有时间均锚定在虚构纪元（NARRATIVE_ANCHOR_UTC_MS）。契约层修正后该参数会一并去除。
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function createGreySaltTownInitialSavePayload(_now: number): ModInitialSavePayload {
  const snapshot = createInitialSnapshot()
  const arrivalTime = addNarrativeTimeOffset(-1000 * 60 * 60 * 30)
  const saltWarehouseTime = addNarrativeTimeOffset(-1000 * 60 * 60 * 18)
  const bellTestTime = addNarrativeTimeOffset(-1000 * 60 * 60 * 6)
  const distractorDemonTime = addNarrativeTimeOffset(-1000 * 60 * 60 * 4)
  const distractorLedgerTime = addNarrativeTimeOffset(-1000 * 60 * 60 * 2)
  const corpseFoundTime = addNarrativeTimeOffset(-1000 * 60 * 45)
  const activeEventTime = addNarrativeTimeOffset(0)
  const events: ModInitialSavePayload["events"] = [
    {
      time: arrivalTime,
      status: "done",
      entityTags: ["叶临", "许砚", "灰盐镇驿馆", "盐巡队"],
      content:
        `${formatSeedTime(arrivalTime)}，叶临和许砚受盐巡队临时委托抵达灰盐镇驿馆。驿馆掌柜韩照声称盐车延误和旅客争吵是近期唯一异常，并没有妖物入镇，但许砚在驿馆账册里发现三笔盐仓夜间开门记录被刮去。`,
    },
    {
      time: saltWarehouseTime,
      status: "done",
      entityTags: ["罗缇", "盐仓", "韩照", "缺扣袖衣"],
      content:
        `${formatSeedTime(saltWarehouseTime)}，失踪的盐商罗缇曾被人看见进过盐仓。韩照说罗缇只是去查盐袋数目，但守夜驿卒后来在盐仓门槛旁捡到一枚铜扣，和韩照常穿的袖衣样式相近。`,
    },
    {
      time: bellTestTime,
      status: "done",
      entityTags: ["许砚", "镇口雨棚", "盐巡队", "青铜验妖铃"],
      content:
        `${formatSeedTime(bellTestTime)}，许砚在镇口雨棚下试过青铜验妖铃。铃没有直接响起，只是偏向灰盐镇驿馆后院方向，说明妖气可能被盐灰、雨水或血气遮住。盐巡队因此封住了镇口，不许盐车连夜离开。`,
    },
    {
      time: distractorDemonTime,
      status: "done",
      entityTags: ["赵槐", "河堤盐亭", "青铜验妖铃", "白鳞鱼妖"],
      content:
        `${formatSeedTime(distractorDemonTime)}，盐巡队在河堤盐亭抓住过卖假盐的赵槐。许砚曾用青铜验妖铃试过现场，铃声短促但方向指向河道，最后只查出一尾受伤的白鳞鱼妖，与灰盐镇驿馆后院并无直接关系。`,
    },
    {
      time: distractorLedgerTime,
      status: "done",
      entityTags: ["米娘", "前厅账册", "灰盐镇驿馆", "盐巡队"],
      content:
        `${formatSeedTime(distractorLedgerTime)}，前厅伙计米娘主动交出一本前厅账册，说韩照近来常把盐车住宿费记错。许砚核过后确认这只是旧账亏空，和盐仓夜间开门记录不是同一本册子。`,
    },
    {
      time: corpseFoundTime,
      status: "done",
      entityTags: ["叶临", "许砚", "罗缇", "旧井", "黑鳞"],
      content:
        `${formatSeedTime(corpseFoundTime)}，叶临和许砚在驿馆后院旧井边找到罗缇尸体。罗缇袖口带着干盐，井沿外侧有三枚浅爪痕，爪痕里嵌着一片黑鳞，现场看起来像有人先在盐仓动过手，再把尸体搬到旧井旁。`,
    },
    {
      time: activeEventTime,
      status: "ongoing",
      entityTags: ["叶临", "许砚", "韩照", "驿馆后院", "黑鳞", "青铜验妖铃"],
      content:
        `${formatSeedTime(activeEventTime)}，冷雨未停，叶临在驿馆后院把黑鳞夹进油纸袋，青铜验妖铃随即停止颤动。韩照被许砚带到廊下问话，他坚持盐仓钥匙整晚都在自己腰上，但靴底沾着湿盐，右袖还缺了一枚铜扣。`,
    },
  ]
  const archives: ModInitialSavePayload["archives"] = [
    {
      type: "character",
      name: "叶临",
      aliases: ["我", "你", "玩家"],
      background: "接案行走的年轻巡查者，擅长从现场痕迹和证词矛盾中还原事件。",
      situation: "正在驿馆后院检视罗缇尸体、黑鳞和韩照衣物之间的关系。",
      focus: "找出罗缇死亡与盐仓异响、旧井爪痕之间的真实关联。",
      linkedNames: ["许砚", "灰盐镇驿馆", "黑鳞", "青铜验妖铃"],
      presence: "foreground",
      role: "investigator",
      fatigue: "轻微淋雨但仍能行动",
    },
    {
      type: "character",
      name: "许砚",
      aliases: ["许捕头"],
      background: "盐巡队借调来的捕头，熟悉灰盐镇附近盐路和驿馆人情。",
      situation: "守住后院门并控制韩照，避免驿卒和看客破坏现场。",
      focus: "协助叶临稳定现场，逼韩照解释盐仓钥匙和缺扣袖衣。",
      linkedNames: ["叶临", "韩照", "盐巡队", "青铜验妖铃"],
      presence: "foreground",
      trust: "high",
    },
    {
      type: "character",
      name: "韩照",
      aliases: ["韩掌柜"],
      background: "灰盐镇驿馆掌柜，负责盐车住宿、盐仓钥匙和夜间开门登记。",
      situation: "被带到后院廊下问话，靴底沾着湿盐，右袖缺了一枚铜扣。",
      focus: "解释自己为何与盐仓门槛铜扣、湿盐脚印和罗缇尸体都有牵连。",
      linkedNames: ["灰盐镇驿馆", "盐仓", "缺扣袖衣", "罗缇"],
      presence: "foreground",
      suspicionLevel: 4,
    },
    {
      type: "character",
      name: "罗缇",
      aliases: ["罗盐商", "死者"],
      background: "往来灰盐镇和北路盐场的盐商，在盐仓开门记录缺失的那段时间进入过盐仓查看盐袋。",
      situation: "尸体被发现于旧井旁，袖口残留干盐，仵作初判死于夜间二更前后。",
      linkedNames: ["盐仓", "旧井", "黑鳞", "韩照"],
      presence: "foreground",
      status: "dead",
    },
    {
      type: "monster",
      name: "井下鳞妖",
      aliases: ["井下东西", "鳞妖"],
      background: "疑似潜伏在灰盐镇旧井附近的妖物，目前只留下黑鳞、爪痕和被盐灰遮蔽的妖气。",
      situation: "尚未现身，青铜验妖铃只确认其气息可能从旧井或盐仓方向传出。",
      focus: "确认它是否真正杀死罗缇，还是被人用来掩盖人祸。",
      linkedNames: ["旧井", "黑鳞", "青铜验妖铃"],
      presence: "background",
      threatLevel: "unknown",
    },
    {
      type: "location",
      name: "灰盐镇驿馆",
      aliases: ["驿馆"],
      background: "灰盐镇盐车和行旅停宿的主要驿馆，前厅、后院、盐仓和旧井都连在一处。",
      situation: "命案发生后被盐巡队临时封住，外客只能留在前厅等候。",
      linkedNames: ["驿馆后院", "盐仓", "旧井", "韩照"],
      presence: "foreground",
      security: "封锁中",
    },
    {
      type: "location",
      name: "驿馆后院",
      aliases: ["后院"],
      background: "驿馆后方的小院，一侧通旧井，一侧连盐仓侧门。",
      situation: "冷雨未停，罗缇尸体、井沿爪痕和湿盐脚印都集中在这里。",
      linkedNames: ["旧井", "盐仓", "罗缇", "黑鳞"],
      presence: "foreground",
      lighting: "油灯昏暗",
    },
    {
      type: "location",
      name: "盐仓",
      aliases: ["驿馆盐仓"],
      background: "驿馆用于暂存官盐和商盐的仓房，门钥匙由韩照保管。",
      situation: "门槛附近发现过铜扣，夜间开门记录被刮去，仓内还残留湿盐拖痕。",
      linkedNames: ["韩照", "罗缇", "缺扣袖衣", "驿馆后院"],
      presence: "foreground",
      access: "钥匙未明",
    },
    {
      type: "location",
      name: "旧井",
      aliases: ["后院旧井"],
      background: "驿馆后院废弃多年的老井，平时只用木盖压住。",
      situation: "井沿有三枚浅爪痕，爪痕里曾嵌着黑鳞，井口有被雨水冲淡的腥味。",
      linkedNames: ["黑鳞", "井下鳞妖", "驿馆后院"],
      presence: "foreground",
      hazard: "疑似妖气来源",
    },
    {
      type: "location",
      name: "镇口雨棚",
      aliases: ["雨棚"],
      background: "灰盐镇镇口临时避雨处，盐巡队在此拦截出镇盐车。",
      situation: "盐巡队仍在雨棚下查验车队，暂时不许任何盐车离镇。",
      linkedNames: ["盐巡队", "灰盐镇驿馆"],
      presence: "background",
    },
    {
      type: "location",
      name: "河堤盐亭",
      aliases: ["盐亭"],
      background: "灰盐镇外河堤旁的小亭，盐巡队常在那里查验散盐和夜行小贩。",
      situation: "已查过假盐小贩和白鳞鱼妖，与驿馆命案没有直接现场连接。",
      linkedNames: ["赵槐", "白鳞鱼妖", "盐巡队"],
      presence: "background",
    },
    {
      type: "organization",
      name: "盐巡队",
      aliases: ["盐巡"],
      background: "负责灰盐镇盐路治安和盐税盘查的巡队，拥有临时封路权限。",
      situation: "已经封住镇口和驿馆前厅，但还没正式接管后院现场。",
      focus: "阻止涉案人员和盐车离开灰盐镇，等待叶临和许砚给出初步判断。",
      linkedNames: ["许砚", "镇口雨棚", "灰盐镇驿馆"],
      presence: "background",
    },
    {
      type: "character",
      name: "赵槐",
      aliases: ["假盐小贩"],
      background: "在河堤盐亭附近贩卖掺沙假盐的小贩，常用妖物传闻吓退查盐的人。",
      situation: "已被盐巡队扣在镇口雨棚附近，暂时不像能进入驿馆后院。",
      linkedNames: ["河堤盐亭", "白鳞鱼妖", "盐巡队"],
      presence: "background",
      suspicionLevel: 1,
    },
    {
      type: "character",
      name: "米娘",
      aliases: ["前厅伙计"],
      background: "灰盐镇驿馆前厅伙计，负责给盐车客人登记住宿和热水。",
      situation: "已交出前厅账册，账册问题更像旧账亏空而不是命案主线。",
      linkedNames: ["前厅账册", "灰盐镇驿馆"],
      presence: "background",
      trust: "medium",
    },
    {
      type: "monster",
      name: "白鳞鱼妖",
      aliases: ["河道鱼妖"],
      background: "河堤盐亭附近被盐巡队短暂追查的小妖，鳞色发白，妖气很弱。",
      situation: "已经逃回河道，只能解释河堤盐亭的铃声，不能解释旧井黑鳞。",
      linkedNames: ["河堤盐亭", "赵槐", "青铜验妖铃"],
      presence: "background",
      threatLevel: "low",
    },
    {
      type: "equipment",
      name: "青铜验妖铃",
      aliases: ["验妖铃"],
      background: "许砚带来的旧式验妖器，能在妖气接近时偏转或鸣响。",
      situation: "靠近井沿爪痕时曾半响，黑鳞被夹进油纸袋后停止颤动。",
      linkedNames: ["许砚", "黑鳞", "井下鳞妖"],
      presence: "foreground",
      quantity: 1,
      quality: "worn",
      effects: ["探测妖气", "提示方向"],
    },
    {
      type: "equipment",
      name: "短刃",
      aliases: ["许砚的短刃"],
      background: "许砚惯用的近身武器，适合在狭窄后院和廊下控人。",
      situation: "被许砚压在袖中，没有出鞘。",
      linkedNames: ["许砚"],
      presence: "background",
      quantity: 1,
      quality: "common",
      statBonuses: { control: 1 },
    },
    {
      type: "consumable",
      name: "油纸袋",
      aliases: ["证物袋"],
      background: "用来临时封存潮湿证物的小油纸袋。",
      situation: "已经装入黑鳞，袋口被叶临折了两道以防雨水继续浸泡。",
      linkedNames: ["黑鳞", "叶临"],
      presence: "foreground",
      quantity: 2,
      remainingUses: 1,
      useEffect: "封存小型证物，隔绝雨水和直接接触",
    },
    {
      type: "material",
      name: "湿盐",
      aliases: ["盐泥", "湿盐脚印"],
      background: "盐仓附近被雨水泡湿后形成的盐泥，容易粘在靴底和衣摆上。",
      situation: "韩照靴底、罗缇袖口和盐仓门槛都发现了相似湿盐痕迹。",
      linkedNames: ["韩照", "罗缇", "盐仓"],
      presence: "foreground",
      quantity: 3,
      source: "盐仓门槛与后院泥水",
      usage: "比对行动路线和搬尸痕迹",
    },
    {
      type: "clue",
      name: "黑鳞",
      aliases: ["鳞片", "井沿鳞片"],
      background: "嵌在旧井爪痕最深处的一片黑色鳞片，被雨水泡软但没有腐坏。",
      situation: "已被叶临夹进油纸袋，青铜验妖铃因此停止颤动。",
      linkedNames: ["旧井", "井下鳞妖", "青铜验妖铃"],
      presence: "foreground",
      evidenceState: "sealed",
    },
    {
      type: "clue",
      name: "缺扣袖衣",
      aliases: ["缺扣右袖", "韩照袖衣"],
      background: "韩照被问话时穿着的深色袖衣，右袖缺了一枚铜扣。",
      situation: "缺口样式与盐仓门槛旁捡到的铜扣相近，但尚未正式比对。",
      linkedNames: ["韩照", "盐仓", "铜扣"],
      presence: "foreground",
      evidenceState: "unverified",
    },
    {
      type: "clue",
      name: "铜扣",
      aliases: ["盐仓铜扣"],
      background: "守夜驿卒在盐仓门槛旁捡到的一枚小铜扣。",
      situation: "暂时由盐巡队收着，尚未拿来和韩照右袖缺口比对。",
      linkedNames: ["缺扣袖衣", "盐仓", "韩照"],
      presence: "background",
      evidenceState: "held_by_patrol",
    },
    {
      type: "clue",
      name: "前厅账册",
      aliases: ["住宿账册"],
      background: "米娘交出的前厅住宿账册，记录多笔盐车住宿费和热水钱。",
      situation: "已经被许砚初步核过，问题集中在旧账亏空，不是盐仓夜间开门记录。",
      linkedNames: ["米娘", "灰盐镇驿馆"],
      presence: "background",
      evidenceState: "distractor_checked",
    },
    {
      type: "material",
      name: "掺沙假盐",
      aliases: ["假盐"],
      background: "赵槐在河堤盐亭附近兜售的劣质假盐，盐粒里混有细沙。",
      situation: "已被盐巡队收缴，和韩照靴底的湿盐痕迹质地不同。",
      linkedNames: ["赵槐", "河堤盐亭"],
      presence: "background",
      quantity: 1,
      source: "河堤盐亭",
      usage: "作为干扰性盐类线索，避免把所有盐痕都归到同一事件",
    },
  ]

  return {
    snapshot,
    events,
    archives,
  }
}

const archiveCatalog = createGreySaltTownInitialSavePayload(0).archives

/**
 * 模组自带工作流声明（SC-CRIT-3 验证：mod 注册路径验证）。
 *
 * 形状与 platform-web 默认工作流一致（retrieval → chat → reply / maintenance，
 * 不含 apply-patch）。
 *
 * HC-13 判定：platform-host 当前 resolveWorkflowForMod 实现中
 * 所有 mod 走 default-workflow 且 isModWorkflow=false；
 * 即使未来改为读 mod.workflow，也应以 isModWorkflow=true 加载，
 * 因此本 workflow 绝对不能包含 apply-patch 节点，避免触发 MOD_REGISTERED_APPLY_PATCH 校验。
 * apply-patch 由平台负责，mod 只声明检索 + 正文 AI 链路。
 */
const greySaltTownWorkflow: WorkflowDefinition = {
  nodes: [
    {
      // retrieval：β-1 旁路，从宏 __retrieval.raw 读取 platform-host 组装好的检索 prompt
      id: "retrieval",
      type: "ai-call",
      config: {
        presetId: "builtin.retrieval",
        bypass: { rawFromMacro: "__retrieval.raw" },
      },
      outputs: [
        { name: "prompt", extract: { type: "tag", tag: "prompt" } },
        { name: "directEntities", extract: { type: "tag", tag: "directEntities", parse: "json" } },
      ],
    },
    {
      // chat：正文 AI，注入检索 prompt，追加 user.input
      id: "chat",
      type: "ai-call",
      config: { presetId: "builtin.chat", appendUserInput: true },
    },
    {
      // reply：result 节点，把 chat 输出写入 results.reply
      id: "reply",
      type: "result",
      config: { name: "reply" },
    },
    {
      // maintenance：维护 AI，读取正文 + 直接实体，输出 patch JSON
      id: "maintenance",
      type: "ai-call",
      config: { presetId: "builtin.maintenance" },
      outputs: [
        { name: "patch", extract: { type: "raw", parse: "json" } },
      ],
    },
    // 注意：apply-patch 节点刻意省略。
    // HC-13 强约束：mod 工作流不允许注册 apply-patch（MOD_REGISTERED_APPLY_PATCH）。
    // patch 应用由平台（platform-host / default-workflow）负责，mod 只声明 AI 链路。
  ],
  edges: [
    {
      from: { nodeId: "retrieval", outputName: "prompt" },
      to: { nodeId: "chat", varName: "retrieval.prompt" },
    },
    {
      from: { nodeId: "chat", outputName: "raw" },
      to: { nodeId: "reply", varName: "value" },
    },
    {
      from: { nodeId: "chat", outputName: "raw" },
      to: { nodeId: "maintenance", varName: "lastReply" },
    },
    {
      from: { nodeId: "retrieval", outputName: "directEntities" },
      to: { nodeId: "maintenance", varName: "directEntities" },
    },
  ],
}

export const greySaltTownMod: ModStaticContent = {
  manifest: {
    id: "grey-salt-town",
    name: "灰盐镇测试模组",
    version: "0.1.0",
    author: "Tsian Prototype",
    description: "用于验证模组静态层、预设事件钩子和记忆系统的开发期内置测试模组。",
    // SC-CRIT-3：声明 mod 自带工作流，验证 mod 注册路径
    workflow: greySaltTownWorkflow,
  },
  frontendConfig: {
    frontendId: "official-default",
  },
  entityTypeDefinitions: [
    { type: "character", label: "角色", fields: [] },
    { type: "location", label: "地点", fields: [] },
    { type: "organization", label: "组织", fields: [] },
    { type: "monster", label: "怪物", fields: [] },
    { type: "equipment", label: "装备", fields: [] },
    { type: "consumable", label: "消耗品", fields: [] },
    { type: "material", label: "材料", fields: [] },
    { type: "clue", label: "线索", fields: [] },
  ],
  globalsDefaults: {
    章节: "灰盐镇·雨夜验尸",
    当前地点: "灰盐镇驿馆后院",
    天气: "子夜后，冷雨未停",
    当前目标: "确认驿馆命案、盐仓异响和旧井黑鳞是否有关",
    同行者: ["许砚"],
  },
  archiveCatalog,
  eventCatalog: [
    {
      id: "grey-salt-town-salt-warehouse-token",
      name: "盐仓令牌线索浮现",
      entityTags: ["韩照", "盐仓", "缺扣袖衣", "铜扣"],
      content:
        "韩照的盐仓说法被追问到破绽处时，可以露出一枚盐仓令牌或令牌相关证词，将钥匙、铜扣和夜间开门记录连起来。",
      trigger: {
        requiredEntityNames: ["韩照", "盐仓"],
      },
      guidance:
        "如果当前剧情仍在审问韩照或核对盐仓线索，可以让令牌以证词、物证或间接线索出现；如果玩家没有追问盐仓，不要强行推进。",
    },
    {
      id: "grey-salt-town-well-scale-reaction",
      name: "旧井黑鳞再度反应",
      entityTags: ["黑鳞", "旧井", "青铜验妖铃", "井下鳞妖"],
      content:
        "当黑鳞、旧井或验妖铃再次被检查时，旧井方向可以出现更明确的妖气反应，暗示井下鳞妖不是普通水妖。",
      trigger: {
        requiredEntityNames: ["黑鳞", "青铜验妖铃"],
      },
      guidance:
        "只作为可吸收的气氛和线索推进，不要直接替玩家揭晓井下鳞妖身份。",
    },
  ],
}


