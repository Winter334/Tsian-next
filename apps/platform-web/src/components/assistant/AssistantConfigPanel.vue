<template>
  <div class="flex max-h-[70vh] min-h-0 flex-col">
    <div class="grid min-h-0 flex-1 gap-3 overflow-auto p-1">
      <!-- Skills section -->
      <section class="border border-neon-deep/35 bg-panel/55">
        <div class="flex items-center justify-between border-b border-neon-deep/25 px-3 py-2">
          <p class="font-mono text-[11px] uppercase tracking-wider text-neon">Skills</p>
          <p class="font-mono text-[11px] text-text-dim">{{ enabledSkillCount }} / {{ skills.length }} 已启用</p>
        </div>
        <div class="grid gap-2 p-3">
          <div
            v-for="skill in skills"
            :key="skill.path"
            class="border border-neon-deep/30 bg-elevated/45 hover:bg-elevated"
          >
            <div
              class="retro-focus grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start"
            >
              <span class="min-w-0">
                <span class="block truncate text-sm font-bold text-text-main">{{ skill.title }}</span>
                <span class="mt-1 block line-clamp-2 text-xs leading-5 text-text-dim">{{ entrySummary(skill.description || skill.summary) }}</span>
                <span class="mt-2 block break-all font-mono text-[11px] text-neon-muted">{{ skill.path }}</span>
              </span>
              <Switch
                :model-value="skillEnabled(skill)"
                :disabled="applying || !agent"
                :aria-label="skill.title"
                @update:model-value="(value) => toggleSkill(skill, Boolean(value))"
              />
            </div>
            <!-- Skill config (skill.config 声明的配置项):仅声明了 configItems 的 skill 渲染。
                 点输入框不触发上方 checkbox;value 走草稿,应用时统一保存。 -->
            <div
              v-if="skill.configItems && skill.configItems.length > 0"
              class="grid gap-3 border-t border-neon-deep/20 p-3"
              @click.stop
            >
              <p class="font-mono text-[11px] uppercase tracking-wider text-neon-muted">
                配置{{ skillConfigChanged(skill.path) ? " · 未保存" : "" }}
              </p>
              <label
                v-for="item in skill.configItems"
                :key="item.key"
                class="grid gap-1"
              >
                <span class="text-xs text-text-dim">
                  <span class="font-mono text-text-main">{{ item.key }}</span>
                  <span v-if="item.description" class="ml-1">{{ item.description }}</span>
                </span>
                <input
                  class="retro-focus h-8 w-full border border-neon-deep/30 bg-panel/60 px-2 font-mono text-xs text-text-main"
                  :type="isSecretKey(item.key) ? 'password' : 'text'"
                  :value="configValue(skill.path, item)"
                  :disabled="applying"
                  :placeholder="item.defaultValue || ''"
                  spellcheck="false"
                  autocomplete="off"
                  @input="setConfigValue(skill.path, item, ($event.target as HTMLInputElement).value)"
                >
              </label>
            </div>
          </div>

          <p v-if="skills.length === 0" class="border border-neon-deep/35 bg-panel/55 p-3 text-sm text-text-dim">
            助手还没有可管理的 Skill。
          </p>
        </div>
      </section>

      <!-- Platform Tools section -->
      <section class="border border-neon-deep/35 bg-panel/55">
        <div class="border-b border-neon-deep/25 px-3 py-2">
          <p class="font-mono text-[11px] uppercase tracking-wider text-neon-muted">平台工具</p>
        </div>
        <div class="grid gap-3 p-3">
          <div
            v-for="group in platformToolGroups"
            :key="group.title"
            class="border border-neon-deep/20 bg-elevated/30"
          >
            <div class="border-b border-neon-deep/20 px-3 py-1.5">
              <p class="font-mono text-[11px] uppercase tracking-wider text-neon-muted">{{ group.title }}</p>
            </div>
            <div class="grid gap-2 p-3">
              <PlatformToolCard
                v-for="tool in group.tools"
                :key="tool.id"
                :tool="tool"
                :enabled="platformToolEnabled(tool.id)"
                :disabled="applying || !agent"
                @toggle="(enabled) => togglePlatformTool(tool.id, enabled)"
              />
            </div>
          </div>
        </div>
      </section>

      <!-- Workspace Access section -->
      <section class="border border-neon-deep/35 bg-panel/55">
        <div class="border-b border-neon-deep/25 px-3 py-2">
          <p class="font-mono text-[11px] uppercase tracking-wider text-neon-muted">Workspace 权限</p>
        </div>
        <div class="grid gap-3 p-3">
          <label class="grid gap-2">
            <span class="text-xs font-bold text-text-main">权限等级</span>
            <Select
              :model-value="String(workspaceLevel)"
              :disabled="applying || !agent"
              @update:model-value="(value) => updateWorkspaceAccessLevel(Number(value))"
            >
              <SelectTrigger class="h-9 w-full">
                <SelectValue placeholder="选择权限等级" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="option in workspaceAccessOptions"
                  :key="option.level"
                  :value="String(option.level)"
                >
                  {{ option.label }}
                </SelectItem>
              </SelectContent>
            </Select>
          </label>
          <p class="text-xs leading-5 text-text-dim">{{ workspaceAccessDescription }}</p>
        </div>
      </section>

    </div>

    <!-- Footer: Windows-style 取消/应用/确定 (X in title bar also cancels) -->
    <div class="flex items-center justify-between gap-2 border-t border-neon-deep/30 px-3 py-3">
      <button
        type="button"
        class="retro-button retro-focus inline-flex h-8 items-center px-3 font-mono text-xs"
        :disabled="applying"
        @click="cancelChanges"
      >
        取消
      </button>
      <div class="flex gap-2">
        <button
          type="button"
          class="retro-button retro-focus inline-flex h-8 items-center px-3 font-mono text-xs disabled:opacity-45"
          :disabled="!hasChanges || applying"
          @click="applyChanges"
        >
          应用
        </button>
        <button
          type="button"
          class="retro-button retro-focus inline-flex h-8 items-center px-3 font-mono text-xs disabled:opacity-45"
          :disabled="applying"
          @click="confirmChanges"
        >
          确定
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import type {
  AgentPlatformToolName,
  AgentRegistryEntry,
  SkillRegistryEntry,
} from "@tsian/contracts"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { isAgentPlatformToolEnabled } from "@/agent-runtime/permissions"
import { PLATFORM_TOOL_CONTROL_GROUPS } from "@/agent-runtime/tool-controls"
import { isSkillEnabledForAgent } from "@/agent-runtime/registry"
import { toast } from "@/composables/useToast"
import PlatformToolCard from "@/components/common/PlatformToolCard.vue"
import {
  getLocalAssistantConfig,
  updateLocalAssistantPlatformToolEnabled,
  updateLocalAssistantSkillConfig,
  updateLocalAssistantSkillEnabled,
  updateLocalAssistantWorkspaceAccess,
  type LocalAssistantConfig,
} from "@/platform-host"
import type { SkillConfigItem } from "@tsian/contracts"

const emit = defineEmits<{
  (event: "change"): void
  (event: "close"): void
}>()

const agent = ref<AgentRegistryEntry | null>(null)
const skills = ref<SkillRegistryEntry[]>([])

/**
 * 草稿覆盖层:只记录与原始持久化状态不同的字段。toggle 只改草稿,
 * 不触发持久化;点「应用」/「确定」时 diff 草稿与原始状态,逐字段调
 * setter 保存。这样复用现有单字段 setter,避免重写全量保存逻辑。
 */
const skillOverrides = ref(new Map<string, boolean>())
const platformToolOverrides = ref(new Map<AgentPlatformToolName, boolean>())
const workspaceLevelOverride = ref<number | null>(null)
const applying = ref(false)

/**
 * Skill config 初始值(玩家已存值 ?? 默认值),reload 时填充。
 * key = skill.path,value = Record<configKey, initialValue>。
 */
const skillConfigInitial = ref(new Map<string, Record<string, string>>())
/**
 * Skill config 草稿覆盖:只记与初始值不同的 key。编辑只改草稿,
 * 应用时逐 skill 调 updateLocalAssistantSkillConfig 保存全量。
 */
const skillConfigDraft = ref(new Map<string, Record<string, string>>())

const platformToolGroups = PLATFORM_TOOL_CONTROL_GROUPS

const workspaceAccessOptions = [
  {
    level: 0,
    label: "只读",
    description: "只能读取普通游戏卡和存档内容。",
  },
  {
    level: 1,
    label: "可维护存档",
    description: "可以维护当前存档的运行时文件。",
  },
  {
    level: 2,
    label: "可编辑游戏卡",
    description: "可以编辑游戏卡内容；当前运行时仍会优先限制普通写入到存档。",
  },
  {
    level: 4,
    label: "平台维护",
    description: "允许访问平台元数据能力，仅适合受信任的维护 Agent。",
  },
]

// --- 草稿读法(override 优先,回退原始状态) ---
function skillEnabled(skill: SkillRegistryEntry): boolean {
  if (skillOverrides.value.has(skill.path)) {
    return skillOverrides.value.get(skill.path) ?? false
  }
  return agent.value ? isSkillEnabledForAgent(skill, agent.value) : false
}

function platformToolEnabled(tool: AgentPlatformToolName): boolean {
  if (platformToolOverrides.value.has(tool)) {
    return platformToolOverrides.value.get(tool) ?? false
  }
  return agent.value ? isAgentPlatformToolEnabled(agent.value, tool) : false
}

const workspaceLevel = computed(() => workspaceLevelOverride.value ?? agent.value?.workspaceAccess.level ?? 1)

const enabledSkillCount = computed(() => skills.value.filter((s) => skillEnabled(s)).length)

const workspaceAccessDescription = computed(() =>
  workspaceAccessOptions.find((option) => option.level === workspaceLevel.value)?.description ?? "",
)

/** key 名含 KEY/SECRET/TOKEN/PASSWORD 时输入框用 password 遮蔽(无需声明类型)。 */
function isSecretKey(key: string): boolean {
  const upper = key.toUpperCase()
  return ["KEY", "SECRET", "TOKEN", "PASSWORD"].some((s) => upper.includes(s))
}

/** 技能声明了 configItems 的列表(只这些渲染配置区)。 */
const skillsWithConfig = computed(() =>
  skills.value.filter((skill) => skill.configItems && skill.configItems.length > 0),
)

/**
 * 取某 skill 某 key 的当前显示值:草稿优先,回退初始值,再回退默认值。
 */
function configValue(skillPath: string, item: SkillConfigItem): string {
  const draft = skillConfigDraft.value.get(skillPath)
  if (draft && item.key in draft) {
    return draft[item.key]
  }
  const initial = skillConfigInitial.value.get(skillPath)
  if (initial && item.key in initial) {
    return initial[item.key]
  }
  return item.defaultValue
}

/**
 * 编辑某 key:写入草稿。若新值等于初始值则从草稿移除(保持草稿只记差异)。
 */
function setConfigValue(skillPath: string, item: SkillConfigItem, value: string): void {
  if (applying.value) {
    return
  }
  const initial = skillConfigInitial.value.get(skillPath) ?? {}
  const next = { ...(skillConfigDraft.value.get(skillPath) ?? {}) }
  if (value === (initial[item.key] ?? item.defaultValue)) {
    delete next[item.key]
  } else {
    next[item.key] = value
  }
  const nextDraft = new Map(skillConfigDraft.value)
  if (Object.keys(next).length === 0) {
    nextDraft.delete(skillPath)
  } else {
    nextDraft.set(skillPath, next)
  }
  skillConfigDraft.value = nextDraft
}

/** 某 skill 是否有未保存的 config 变更。 */
function skillConfigChanged(skillPath: string): boolean {
  return skillConfigDraft.value.has(skillPath)
}

const hasChanges = computed(() =>
  skillOverrides.value.size > 0
  || platformToolOverrides.value.size > 0
  || workspaceLevelOverride.value !== null
  || skillConfigDraft.value.size > 0,
)

function entrySummary(value: string | undefined): string {
  return value?.trim() || "暂无简介。"
}

// --- 草稿写入(只改 override,不持久化) ---
function toggleSkill(skill: SkillRegistryEntry, enabled: boolean): void {
  if (applying.value) {
    return
  }
  const original = agent.value ? isSkillEnabledForAgent(skill, agent.value) : false
  const next = new Map(skillOverrides.value)
  if (enabled === original) {
    next.delete(skill.path)
  } else {
    next.set(skill.path, enabled)
  }
  skillOverrides.value = next
}

function togglePlatformTool(tool: AgentPlatformToolName, enabled: boolean): void {
  if (applying.value) {
    return
  }
  const original = agent.value ? isAgentPlatformToolEnabled(agent.value, tool) : false
  const next = new Map(platformToolOverrides.value)
  if (enabled === original) {
    next.delete(tool)
  } else {
    next.set(tool, enabled)
  }
  platformToolOverrides.value = next
}

function updateWorkspaceAccessLevel(level: number): void {
  if (applying.value) {
    return
  }
  workspaceLevelOverride.value = level
}

async function reload(): Promise<void> {
  const result: LocalAssistantConfig = await getLocalAssistantConfig()
  agent.value = result.agent
  skills.value = result.skills
  // Build initial config values per skill: player-saved value ?? default.
  const initial = new Map<string, Record<string, string>>()
  for (const skill of result.skills) {
    if (!skill.configItems || skill.configItems.length === 0) {
      continue
    }
    const saved = result.skillConfigValues[skill.path] ?? {}
    const values: Record<string, string> = {}
    for (const item of skill.configItems) {
      values[item.key] = item.key in saved ? saved[item.key] : item.defaultValue
    }
    initial.set(skill.path, values)
  }
  skillConfigInitial.value = initial
}

function resetOverrides(): void {
  skillOverrides.value = new Map()
  platformToolOverrides.value = new Map()
  workspaceLevelOverride.value = null
  skillConfigDraft.value = new Map()
}

/**
 * 把草稿差异持久化到 agent.json。逐字段 diff 调现有单字段 setter,
 * 只保存真正改变的字段。返回是否全部成功。
 */
async function applyChanges(): Promise<boolean> {
  if (!agent.value || !hasChanges.value || applying.value) {
    return true
  }
  applying.value = true
  try {
    for (const [path, enabled] of skillOverrides.value) {
      await updateLocalAssistantSkillEnabled({ skillPath: path, enabled })
    }
    for (const [tool, enabled] of platformToolOverrides.value) {
      await updateLocalAssistantPlatformToolEnabled({ tool, enabled })
    }
    if (workspaceLevelOverride.value !== null) {
      await updateLocalAssistantWorkspaceAccess(workspaceLevelOverride.value)
    }
    // Skill config: persist the full merged set (initial + draft overrides)
    // per skill — the storage layer replaces the record for each skill dir.
    for (const [skillPath, draftValues] of skillConfigDraft.value) {
      const initial = skillConfigInitial.value.get(skillPath) ?? {}
      const merged = { ...initial, ...draftValues }
      await updateLocalAssistantSkillConfig(skillPath, merged)
    }
    await reload()
    resetOverrides()
    emit("change")
    toast.success("助手配置已应用")
    return true
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "应用配置失败。")
    // 失败时 reload 拿到当前真实状态(可能部分字段已保存成功),
    // 清空 override 让用户看到真实状态再决定是否重新调整。
    await reload()
    resetOverrides()
    return false
  } finally {
    applying.value = false
  }
}

/** 确定 = 应用 + 关闭;应用失败则不关闭。 */
async function confirmChanges(): Promise<void> {
  if (applying.value) {
    return
  }
  const ok = await applyChanges()
  if (ok) {
    emit("close")
  }
}

/** 取消 = 丢弃草稿 + 关闭(与标题栏 X 行为一致)。 */
function cancelChanges(): void {
  if (applying.value) {
    return
  }
  resetOverrides()
  emit("close")
}

onMounted(() => {
  reload().catch((error) => {
    toast.error(error instanceof Error ? error.message : "无法加载助手配置。")
  })
})

defineExpose({ reload })
</script>
