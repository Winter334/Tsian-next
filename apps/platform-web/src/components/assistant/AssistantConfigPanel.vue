<template>
  <div class="flex max-h-[70vh] min-h-0 flex-col">
    <div class="grid min-h-0 flex-1 gap-3 overflow-auto p-1">
      <!-- Workspace Access section -->
      <section class="border border-neon-deep/35 bg-panel/55">
        <div class="border-b border-neon-deep/25 px-3 py-2">
          <p class="text-sm font-bold text-text-main">权限边界</p>
          <p class="mt-0.5 text-xs leading-5 text-text-dim">决定桌面助手能维护哪些 Workspace 区域。</p>
        </div>
        <div class="grid gap-3 p-3">
          <label class="grid gap-2">
            <span class="text-xs font-bold text-text-main">Workspace 权限</span>
            <Select
              :model-value="String(workspaceLevel)"
              :disabled="applying || updatingKnowledge || !agent"
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

      <section class="border border-neon-deep/35 bg-panel/55">
        <div class="border-b border-neon-deep/25 px-3 py-2">
          <p class="text-sm font-bold text-text-main">助手知识库</p>
          <p class="mt-0.5 text-xs leading-5 text-text-dim">
            更新桌面助手理解 Tsian 所需的基础说明。
          </p>
        </div>
        <div class="grid gap-3 p-3">
          <p class="text-xs leading-5 text-text-dim">
            只会更新助手用于理解 Tsian 的内置说明；不会改变你的助手设定、风格、个人笔记、模型与权限设置、自定义能力，也不会修改当前游戏卡内容。
          </p>
          <div class="flex justify-end">
            <button
              type="button"
              class="retro-button retro-focus inline-flex h-8 items-center px-3 font-mono text-xs disabled:opacity-45"
              :disabled="applying || updatingKnowledge || hasChanges"
              :title="hasChanges ? '请先应用或取消未保存的助手配置变更' : '更新助手理解 Tsian 所需的基础说明'"
              @click="refreshKnowledge"
            >
              {{ updatingKnowledge ? "更新中..." : "更新助手知识" }}
            </button>
          </div>
        </div>
      </section>

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
                :disabled="applying || updatingKnowledge || !agent"
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
                  :disabled="applying || updatingKnowledge"
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

      <!-- Capability section -->
      <section class="border border-neon-deep/35 bg-panel/55">
        <div class="flex flex-wrap items-start justify-between gap-3 border-b border-neon-deep/25 px-3 py-2">
          <div>
            <p class="text-sm font-bold text-text-main">能力开关</p>
            <p class="mt-0.5 text-xs leading-5 text-text-dim">平台能力与助手本地 Tool 共用这一组可调用能力配置。</p>
          </div>
          <div class="flex flex-wrap items-center justify-end gap-3">
            <p class="font-mono text-[11px] text-text-dim">
              {{ enabledAssistantCapabilityCount }} / {{ assistantCapabilities.length }} 已启用
            </p>
            <ParamTip
              v-if="toolDiagnostics.length > 0"
              tone="warning"
              label="助手本地 Tool 诊断"
              :trigger-text="`${toolDiagnostics.length} 条诊断`"
            >
              <div class="grid gap-2">
                <p class="text-xs font-bold text-warning">助手本地 Tool 诊断</p>
                <div
                  v-for="(diag, index) in toolDiagnostics"
                  :key="`${diag.code}-${index}`"
                  class="border border-neon-deep/30 bg-elevated/50 p-2"
                >
                  <div class="flex flex-wrap items-center gap-2">
                    <span
                      class="border px-1 py-0.5 font-mono text-[10px] uppercase"
                      :class="diagLevelClass(diag.level)"
                    >{{ diag.level }}</span>
                    <span class="font-mono text-[11px] text-text-main">{{ diag.code }}</span>
                  </div>
                  <p v-if="diag.path" class="mt-1 truncate font-mono text-[11px] text-text-dim">{{ diag.path }}</p>
                  <p class="mt-1 text-[11px] leading-5 text-text-main">{{ diag.message }}</p>
                  <p v-if="diag.hint" class="mt-0.5 text-[11px] leading-5 text-text-dim">Hint: {{ diag.hint }}</p>
                </div>
              </div>
            </ParamTip>
          </div>
        </div>

        <div class="grid gap-2 p-3">
          <article
            v-for="capability in assistantCapabilities"
            :key="capability.key"
            class="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border border-neon-deep/25 bg-elevated/35 p-3 transition-colors hover:bg-elevated/55"
          >
            <div class="min-w-0">
              <div class="flex min-w-0 flex-wrap items-center gap-2">
                <p class="truncate text-sm font-bold text-text-main">{{ capability.title }}</p>
                <span class="border border-neon-deep/35 px-1.5 py-0.5 text-[10px] leading-none text-neon-muted">
                  {{ capability.badge }}
                </span>
                <ParamTip :tip="capability.description" :label="capability.title" />
              </div>
              <p class="mt-1 line-clamp-2 text-xs leading-5 text-text-dim">
                {{ capability.description }}
              </p>
              <p v-if="capability.path" class="mt-1 truncate font-mono text-[11px] text-text-dim/80">
                {{ capability.path }}
              </p>
            </div>
            <Switch
              class="mt-0.5"
              :model-value="capability.enabled"
              :disabled="capability.disabled"
              :aria-label="capability.title"
              @update:model-value="(value) => toggleAssistantCapability(capability, Boolean(value))"
            />
          </article>
        </div>

        <div
          v-if="tools.length === 0"
          class="border-t border-neon-deep/20 px-3 py-2 text-xs leading-5 text-text-dim"
        >
          还没有助手本地 Tool。放置 <code class="font-mono text-[11px]">.tsian/local/assistant/tools/&lt;id&gt;/tool.json</code> 后会出现在这里。
        </div>
      </section>

    </div>

    <!-- Footer: Windows-style 取消/应用/确定 (X in title bar also cancels) -->
    <div class="flex items-center justify-between gap-2 border-t border-neon-deep/30 px-3 py-3">
      <button
        type="button"
        class="retro-button retro-focus inline-flex h-8 items-center px-3 font-mono text-xs"
        :disabled="applying || updatingKnowledge"
        @click="cancelChanges"
      >
        取消
      </button>
      <div class="flex gap-2">
        <button
          type="button"
          class="retro-button retro-focus inline-flex h-8 items-center px-3 font-mono text-xs disabled:opacity-45"
              :disabled="!hasChanges || applying || updatingKnowledge"
          @click="applyChanges"
        >
          应用
        </button>
        <button
          type="button"
          class="retro-button retro-focus inline-flex h-8 items-center px-3 font-mono text-xs disabled:opacity-45"
          :disabled="applying || updatingKnowledge"
          @click="confirmChanges"
        >
          确定
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { RegistryDiagnostic } from "@tsian/contracts"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { ParamTip } from "@/components/ui/tip"
import {
  useAssistantConfigController,
} from "@/controllers/assistant/use-assistant-config-controller"

const emit = defineEmits<{
  (event: "change"): void
  (event: "close"): void
}>()

const controller = useAssistantConfigController({
  onChange: () => emit("change"),
  onClose: () => emit("close"),
})
const {
  agent,
  skills,
  tools,
  toolDiagnostics,
  applying,
  updatingKnowledge,
  workspaceAccessOptions,
  assistantCapabilities,
  enabledAssistantCapabilityCount,
  workspaceLevel,
  enabledSkillCount,
  workspaceAccessDescription,
  hasChanges,
  isSecretKey,
  configValue,
  setConfigValue,
  skillConfigChanged,
  entrySummary,
  skillEnabled,
  toggleSkill,
  toggleAssistantCapability,
  updateWorkspaceAccessLevel,
  reload,
  refreshKnowledge,
  applyChanges,
  confirmChanges,
  cancelChanges,
} = controller

function diagLevelClass(level: RegistryDiagnostic["level"]): string {
  if (level === "error") return "border-red-500/50 text-red-300"
  if (level === "warn") return "border-yellow-500/50 text-yellow-200"
  return "border-neon-deep/50 text-neon-muted"
}

defineExpose({ reload })
</script>
