<template>
  <div class="grid h-full min-h-0 place-items-start overflow-auto p-5">
    <div class="grid w-full max-w-2xl gap-4">
      <div class="border-b border-neon-deep/25 pb-3">
        <p class="font-mono text-[10px] uppercase tracking-wider text-neon">检索</p>
        <h2 class="mt-1 text-sm font-bold text-text-main">语义检索 Embedding 配置</h2>
        <p class="mt-1.5 text-xs leading-5 text-text-dim">
          为 save-runtime 记忆（远期剧情、agent notes、memory summary）提供按"含义"召回的能力。
          仅支持 OpenAI 兼容协议（硅基流动 / Qwen / OpenAI / 各中转站）。配置生效后，每回合落盘自动建索引。
        </p>
      </div>

      <!-- 状态提示 -->
      <div
        class="border px-3 py-2 text-xs"
        :class="statusReady
          ? 'border-neon/40 bg-neon/5 text-neon'
          : 'border-neon-deep/40 bg-elevated/40 text-text-dim'"
      >
        {{ statusMessage }}
      </div>

      <form class="grid gap-3" @submit.prevent="handleSave">
        <!-- enabled 开关 -->
        <label class="retro-inset flex items-center justify-between gap-3 p-3">
          <div class="min-w-0">
            <p class="text-xs font-bold text-text-main">启用语义检索</p>
            <p class="mt-0.5 text-[11px] leading-4 text-text-dim">
              开启后，配全以下字段才生效；未配全时索引不生长、工具调用返回空。
            </p>
          </div>
          <input
            v-model="form.enabled"
            type="checkbox"
            class="h-4 w-4 accent-[var(--color-neon)]"
          />
        </label>

        <!-- baseUrl -->
        <label class="retro-inset grid gap-1 p-3">
          <span class="font-mono text-[10px] uppercase tracking-wider text-text-dim">接口地址 baseUrl</span>
          <input
            v-model="form.baseUrl"
            type="text"
            class="retro-focus retro-select-surface w-full border border-neon-deep/55 bg-elevated px-3 py-2 font-mono text-xs text-text-main placeholder:text-text-dim/60"
            placeholder="https://api.siliconflow.cn/v1"
          />
        </label>

        <!-- apiKey -->
        <label class="retro-inset grid gap-1 p-3">
          <span class="font-mono text-[10px] uppercase tracking-wider text-text-dim">API 密钥 apiKey</span>
          <input
            v-model="form.apiKey"
            type="password"
            class="retro-focus retro-select-surface w-full border border-neon-deep/55 bg-elevated px-3 py-2 font-mono text-xs text-text-main placeholder:text-text-dim/60"
            placeholder="sk-..."
            autocomplete="off"
          />
        </label>

        <!-- model -->
        <label class="retro-inset grid gap-1 p-3">
          <span class="font-mono text-[10px] uppercase tracking-wider text-text-dim">模型 model</span>
          <input
            v-model="form.model"
            type="text"
            class="retro-focus retro-select-surface w-full border border-neon-deep/55 bg-elevated px-3 py-2 font-mono text-xs text-text-main placeholder:text-text-dim/60"
            placeholder="Qwen/Qwen3-Embedding-8B"
          />
        </label>

        <!-- dimensions -->
        <label class="retro-inset grid gap-1 p-3">
          <span class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
            向量维度 dimensions <span class="text-neon/70">（必填，从模型规格查得）</span>
          </span>
          <input
            v-model.number="form.dimensions"
            type="number"
            min="0"
            class="retro-focus retro-select-surface w-full border border-neon-deep/55 bg-elevated px-3 py-2 font-mono text-xs text-text-main placeholder:text-text-dim/60"
            placeholder="4096"
          />
          <span class="text-[11px] leading-4 text-text-dim">
            维度是向量存储与 cosine 计算的硬约束，填错会导致静默 bug。请从所选模型的规格说明中查得后填入。
          </span>
        </label>

        <!-- 从 chat preset 复制凭据 -->
        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
            :disabled="!hasChatPreset"
            @click="copyFromChatPreset"
          >
            <Copy class="h-3.5 w-3.5" aria-hidden="true" />
            从 chat preset 复制 baseUrl / apiKey
          </button>
          <span v-if="!hasChatPreset" class="text-[11px] text-text-dim">（暂无 chat 预设可复制）</span>
        </div>

        <div class="flex items-center gap-2 border-t border-neon-deep/25 pt-3">
          <button
            type="submit"
            class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-4 font-mono text-xs"
          >
            <Save class="h-3.5 w-3.5" aria-hidden="true" />
            保存
          </button>
          <span v-if="savedFlash" class="text-[11px] text-neon">已保存</span>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue"
import { Copy, Save } from "lucide-vue-next"
import {
  type BrowserEmbeddingConfig,
  type BrowserPlatformConfigDraft,
  getEmbeddingConfig,
} from "@/config/ai"

const props = defineProps<{
  draft: BrowserPlatformConfigDraft
}>()

const emit = defineEmits<{
  (e: "save", config: BrowserEmbeddingConfig): void
}>()

// 本地表单状态,从已持久化的 embeddingConfig 初始化(props.draft.embeddingConfig
// 是规范化的,但直接读 getEmbeddingConfig() 确保拿到最新持久化值).
const stored = getEmbeddingConfig()
const form = ref<BrowserEmbeddingConfig>({ ...stored })
const savedFlash = ref(false)

const statusReady = computed(() => {
  return (
    form.value.enabled
    && form.value.baseUrl.trim() !== ""
    && form.value.apiKey.trim() !== ""
    && form.value.model.trim() !== ""
    && form.value.dimensions > 0
  )
})

const statusMessage = computed(() => {
  if (!form.value.enabled) {
    return "语义检索未启用。开启并配全字段后生效。"
  }
  if (statusReady.value) {
    return "配置已生效：索引将随每回合落盘自动生长，retrieval agent 可用 semantic_search。"
  }
  return "配置不全（含 dimensions 缺失），语义检索未生效。请补全所有字段。"
})

const hasChatPreset = computed(() => {
  for (const type of props.draft.providerTypes) {
    for (const preset of type.presets) {
      if (preset.baseUrl.trim() !== "" && preset.apiKey.trim() !== "") {
        return true
      }
    }
  }
  return false
})

/** 从第一个配全 baseUrl+apiKey 的 chat preset 复制凭据(UX 糖,只填这两项). */
function copyFromChatPreset(): void {
  for (const type of props.draft.providerTypes) {
    for (const preset of type.presets) {
      if (preset.baseUrl.trim() !== "" && preset.apiKey.trim() !== "") {
        form.value.baseUrl = preset.baseUrl
        form.value.apiKey = preset.apiKey
        return
      }
    }
  }
}

function handleSave(): void {
  emit("save", { ...form.value })
  savedFlash.value = true
  window.setTimeout(() => {
    savedFlash.value = false
  }, 1500)
}
</script>
