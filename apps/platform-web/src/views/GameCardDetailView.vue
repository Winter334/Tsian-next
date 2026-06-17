<template>
  <section class="grid min-h-full grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden">
      <nav class="retro-toolbar flex gap-1 overflow-x-auto border-b px-3 pt-2" aria-label="游戏卡栏目">
        <button
          type="button"
          class="retro-focus inline-flex h-9 shrink-0 items-center gap-2 border border-b-0 border-neon-deep/45 bg-elevated px-3 font-mono text-xs text-text-dim hover:text-text-main"
          @click="router.push('/library')"
        >
          <ArrowLeft class="h-3.5 w-3.5" aria-hidden="true" />
          应用库
        </button>
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          class="retro-focus inline-flex h-9 shrink-0 items-center gap-2 border border-b-0 px-3 font-mono text-xs"
          :class="activeTab === tab.id
            ? 'border-neon-deep bg-void text-neon'
            : 'border-neon-deep/45 bg-elevated text-text-dim hover:text-text-main'"
          @click="activeTab = tab.id"
        >
          <component :is="tab.icon" class="h-3.5 w-3.5" aria-hidden="true" />
          {{ tab.label }}
        </button>
        <button
          type="button"
          class="retro-button retro-focus ml-auto inline-flex h-8 shrink-0 items-center gap-2 px-3 font-mono text-xs"
          :disabled="!card || exporting"
          @click="exportCard"
        >
          <Download class="h-3.5 w-3.5" aria-hidden="true" />
          导出卡包
        </button>
      </nav>

      <div v-if="loading" class="retro-inset m-3 grid min-h-[480px] place-items-center p-4">
          <p class="font-mono text-xs uppercase tracking-[0.22em] text-neon">
          正在加载游戏卡属性
        </p>
      </div>

      <div v-else-if="errorMessage" class="retro-inset m-3 grid min-h-[480px] place-items-center p-4">
        <div class="max-w-lg border border-danger/40 bg-danger/10 p-4">
          <p class="font-mono text-xs uppercase tracking-wider text-danger">
            游戏卡不可用
          </p>
          <p class="mt-2 text-sm leading-6 text-text-dim">
            {{ errorMessage }}
          </p>
        </div>
      </div>

      <div v-else-if="card" class="m-3 overflow-auto">
        <div v-if="activeTab === 'overview'" class="grid gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
          <section class="poster-pane retro-inset relative min-h-[560px] overflow-hidden">
            <img
              v-if="coverUrl"
              :src="coverUrl"
              :alt="card.manifest.cover?.alt || ''"
              class="absolute inset-0 h-full w-full object-cover"
            />
            <div v-else class="absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_30%_20%,rgba(243,197,109,0.22),transparent_28%),linear-gradient(135deg,#3f4d3a,#1e2420)]">
              <Gamepad2 class="h-20 w-20 text-neon-muted" aria-hidden="true" />
            </div>
            <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-void via-void/86 to-transparent p-5 md:p-7">
              <div class="max-w-3xl">
                <p class="font-mono text-xs uppercase tracking-[0.22em] text-neon">
                  {{ frontendStatusLabel }}
                </p>
                <h1 class="mt-2 text-3xl font-black leading-tight text-text-main md:text-5xl">
                  {{ cardTitle }}
                </h1>
                <p class="mt-4 max-w-2xl text-sm leading-7 text-text-main md:text-base">
                  {{ cardDescription }}
                </p>
                <dl class="mt-5 grid gap-3 text-sm text-text-dim sm:grid-cols-3">
                  <div>
                    <dt class="font-mono text-[10px] uppercase tracking-wider text-neon-muted">作者</dt>
                    <dd class="mt-1 truncate text-text-main">{{ cardAuthor }}</dd>
                  </div>
                  <div>
                    <dt class="font-mono text-[10px] uppercase tracking-wider text-neon-muted">版本</dt>
                    <dd class="mt-1 truncate text-text-main">{{ card.manifest.version }}</dd>
                  </div>
                  <div>
                    <dt class="font-mono text-[10px] uppercase tracking-wider text-neon-muted">来源</dt>
                    <dd class="mt-1 truncate text-text-main">{{ card.source }}</dd>
                  </div>
                </dl>
              </div>
            </div>
          </section>

          <section class="retro-inset grid content-start gap-4 p-4">
            <div class="grid gap-3 border border-neon-deep/35 bg-elevated/35 p-3">
              <div class="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p class="font-mono text-xs uppercase tracking-wider text-neon">
                    卡片属性
                  </p>
                  <p class="mt-1 text-xs leading-5 text-text-dim">
                    {{ card.source === 'builtin' ? '内置卡需要先另存为本地副本再分发。' : '保存会更新这张本地游戏卡的 manifest。' }}
                  </p>
                </div>
                <span class="border border-neon-deep/50 bg-panel px-2 py-1 font-mono text-[10px] uppercase text-text-dim">
                  {{ card.source }}
                </span>
              </div>

              <div class="grid gap-2 sm:grid-cols-2">
                <label class="grid gap-1">
                  <span class="font-mono text-[10px] uppercase tracking-wider text-neon-muted">名称</span>
                  <input
                    v-model="metadataName"
                    type="text"
                    class="retro-focus h-8 min-w-0 border border-neon-deep/55 bg-panel px-2 font-mono text-xs text-text-main"
                  />
                </label>
                <label class="grid gap-1">
                  <span class="font-mono text-[10px] uppercase tracking-wider text-neon-muted">版本</span>
                  <input
                    v-model="metadataVersion"
                    type="text"
                    class="retro-focus h-8 min-w-0 border border-neon-deep/55 bg-panel px-2 font-mono text-xs text-text-main"
                  />
                </label>
              </div>

              <label class="grid gap-1">
                <span class="font-mono text-[10px] uppercase tracking-wider text-neon-muted">摘要</span>
                <input
                  v-model="metadataSummary"
                  type="text"
                  class="retro-focus h-8 min-w-0 border border-neon-deep/55 bg-panel px-2 font-mono text-xs text-text-main"
                />
              </label>

              <label class="grid gap-1">
                <span class="font-mono text-[10px] uppercase tracking-wider text-neon-muted">描述</span>
                <textarea
                  v-model="metadataDescription"
                  rows="3"
                  class="retro-focus min-h-20 resize-y border border-neon-deep/55 bg-panel px-2 py-2 text-xs leading-5 text-text-main"
                />
              </label>

              <label class="grid gap-1">
                <span class="font-mono text-[10px] uppercase tracking-wider text-neon-muted">本地副本 ID</span>
                <input
                  v-model="metadataCopyId"
                  type="text"
                  class="retro-focus h-8 min-w-0 border border-neon-deep/55 bg-panel px-2 font-mono text-xs text-text-main"
                  placeholder="local.example-card"
                />
              </label>

              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
                  :disabled="metadataSaving || card.source === 'builtin'"
                  @click="saveMetadata"
                >
                  <Save class="h-3.5 w-3.5" aria-hidden="true" />
                  保存属性
                </button>
                <button
                  type="button"
                  class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
                  :disabled="metadataSaving"
                  @click="copyAsLocalCard"
                >
                  <Copy class="h-3.5 w-3.5" aria-hidden="true" />
                  另存为本地副本
                </button>
              </div>
            </div>

            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p class="font-mono text-xs uppercase tracking-wider text-neon">
                  存档槽
                </p>
                <p class="mt-1 text-sm leading-6 text-text-dim">
                  {{ frontendStatusDescription }}
                </p>
              </div>
              <span class="border border-neon-deep/50 bg-elevated px-2 py-1 font-mono text-[11px] text-text-dim">
                {{ cardSaves.length }} 个槽位
              </span>
            </div>

            <div class="grid gap-2 sm:grid-cols-[1fr_auto]">
              <input
                v-model="newSaveName"
                type="text"
                class="retro-focus h-9 min-w-0 border border-neon-deep/55 bg-elevated px-3 text-sm text-text-main placeholder:text-text-dim/60"
                placeholder="新存档名称"
                @keyup.enter="createSave"
              />
              <button
                type="button"
                class="retro-button retro-focus inline-flex h-9 items-center justify-center gap-2 px-3 font-mono text-xs"
                @click="createSave"
              >
                <Plus class="h-3.5 w-3.5" aria-hidden="true" />
                新建存档
              </button>
            </div>

            <p v-if="feedback" class="border border-neon-deep/40 bg-neon/10 px-3 py-2 text-sm text-neon">
              {{ feedback }}
            </p>

            <div class="grid gap-2">
              <p v-if="cardSaves.length === 0" class="border border-neon-deep/35 bg-elevated/50 p-3 text-sm text-text-dim">
                这张游戏卡还没有创建存档槽。
              </p>

              <article
                v-for="save in cardSaves"
                :key="save.id"
                class="slot-row grid gap-3 border p-3"
                :class="selectedSaveId === save.id ? 'border-neon bg-neon/10' : 'border-neon-deep/40 bg-elevated/45'"
              >
                <div class="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    class="retro-focus min-w-0 text-left"
                    @click="selectSave(save.id)"
                  >
                    <span class="block truncate text-sm font-bold text-text-main">
                      {{ save.name }}
                    </span>
                    <span class="mt-1 block font-mono text-[11px] leading-5 text-text-dim">
                      来源：{{ cardTitle }} · 创建于 {{ formatDateTime(save.createdAt) }}
                    </span>
                    <span class="block font-mono text-[11px] leading-5 text-text-dim">
                      上次使用 {{ formatDateTime(save.updatedAt) }}
                    </span>
                  </button>
                  <span
                    v-if="save.id === activeSaveId"
                    class="shrink-0 border border-neon px-2 py-1 font-mono text-[10px] uppercase text-neon"
                  >
                    当前
                  </span>
                </div>
                <div class="flex flex-wrap gap-2">
                  <button
                    type="button"
                    class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
                    @click="selectSave(save.id)"
                  >
                    <CheckCircle2 class="h-3.5 w-3.5" aria-hidden="true" />
                    选择
                  </button>
                  <button
                    type="button"
                    class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
                    :disabled="!isPlayable"
                    @click="continueSave(save.id)"
                  >
                    <Play class="h-3.5 w-3.5" aria-hidden="true" />
                    继续
                  </button>
                  <button
                    type="button"
                    class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs text-danger"
                    @click="deleteSave(save.id)"
                  >
                    <Trash2 class="h-3.5 w-3.5" aria-hidden="true" />
                    删除
                  </button>
                </div>
              </article>
            </div>
          </section>
        </div>

        <div v-else-if="activeTab === 'saves'" class="retro-inset grid gap-4 p-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p class="font-mono text-xs uppercase tracking-wider text-neon">
                存档槽管理器
              </p>
              <p class="mt-1 text-sm text-text-dim">
                槽位只保存这张游戏卡的游玩数据。
              </p>
            </div>
            <button
              type="button"
              class="retro-button retro-focus inline-flex h-9 items-center gap-2 px-3 font-mono text-xs"
              @click="createSave"
            >
              <Plus class="h-3.5 w-3.5" aria-hidden="true" />
              新建存档
            </button>
          </div>
          <div class="grid gap-2">
            <article
              v-for="save in cardSaves"
              :key="save.id"
              class="grid gap-3 border border-neon-deep/40 bg-elevated/45 p-3 md:grid-cols-[1fr_auto]"
            >
              <div class="min-w-0">
                <h3 class="truncate text-base font-bold text-text-main">{{ save.name }}</h3>
                <p class="mt-1 font-mono text-xs text-text-dim">
                  来源：{{ cardTitle }} · 创建于 {{ formatDateTime(save.createdAt) }} · 更新于 {{ formatDateTime(save.updatedAt) }}
                </p>
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <button type="button" class="retro-button retro-focus h-8 px-3 font-mono text-xs" @click="selectSave(save.id)">选择</button>
                <button type="button" class="retro-button retro-focus h-8 px-3 font-mono text-xs" :disabled="!isPlayable" @click="continueSave(save.id)">继续</button>
                <button type="button" class="retro-button retro-focus h-8 px-3 font-mono text-xs text-danger" @click="deleteSave(save.id)">删除</button>
              </div>
            </article>
            <p v-if="cardSaves.length === 0" class="border border-neon-deep/35 bg-elevated/50 p-3 text-sm text-text-dim">
              这张游戏卡还没有创建存档槽。
            </p>
          </div>
        </div>

        <div v-else-if="activeTab === 'frontend'" class="retro-inset grid gap-4 p-4">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p class="font-mono text-xs uppercase tracking-wider text-neon">
                前端绑定
              </p>
              <p class="mt-1 text-sm leading-6 text-text-dim">
                {{ frontendStatusDescription }}
              </p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <span class="border border-neon-deep/50 bg-elevated px-2 py-1 font-mono text-[11px] text-text-dim">
                {{ frontendStatusLabel }}
              </span>
              <button
                type="button"
                class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
                :disabled="!isPlayable"
                @click="openPlayFromCard"
              >
                <ExternalLink class="h-3.5 w-3.5" aria-hidden="true" />
                打开游玩窗口
              </button>
            </div>
          </div>

          <p v-if="feedback" class="border border-neon-deep/40 bg-neon/10 px-3 py-2 text-sm text-neon">
            {{ feedback }}
          </p>

          <div class="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.65fr)]">
            <section class="grid content-start gap-4 border border-neon-deep/35 bg-elevated/35 p-3">
              <div class="grid gap-2 sm:grid-cols-3" role="group" aria-label="前端类型">
                <button
                  type="button"
                  class="retro-focus flex min-h-20 flex-col items-start gap-2 border p-3 text-left"
                  :class="frontendMode === 'none' ? 'border-neon bg-neon/10 text-neon' : 'border-neon-deep/40 bg-panel/55 text-text-dim hover:text-text-main'"
                  @click="frontendMode = 'none'"
                >
                  <XCircle class="h-4 w-4" aria-hidden="true" />
                  <span class="font-mono text-xs">未配置</span>
                  <span class="text-xs leading-5">保留为内容模板。</span>
                </button>
                <button
                  type="button"
                  class="retro-focus flex min-h-20 flex-col items-start gap-2 border p-3 text-left"
                  :class="frontendMode === 'remote' ? 'border-neon bg-neon/10 text-neon' : 'border-neon-deep/40 bg-panel/55 text-text-dim hover:text-text-main'"
                  @click="frontendMode = 'remote'"
                >
                  <Link2 class="h-4 w-4" aria-hidden="true" />
                  <span class="font-mono text-xs">Remote URL</span>
                  <span class="text-xs leading-5">通过 iframe 加载。</span>
                </button>
                <button
                  type="button"
                  class="retro-focus flex min-h-20 flex-col items-start gap-2 border p-3 text-left"
                  :class="frontendMode === 'packaged' ? 'border-neon bg-neon/10 text-neon' : 'border-neon-deep/40 bg-panel/55 text-text-dim hover:text-text-main'"
                  @click="frontendMode = 'packaged'"
                >
                  <PackageOpen class="h-4 w-4" aria-hidden="true" />
                  <span class="font-mono text-xs">Packaged</span>
                  <span class="text-xs leading-5">使用卡包内文件。</span>
                </button>
              </div>

              <label v-if="frontendMode === 'remote'" class="grid gap-2">
                <span class="font-mono text-[11px] uppercase tracking-wider text-neon-muted">远程 URL</span>
                <input
                  v-model="remoteUrl"
                  type="url"
                  class="retro-focus h-9 border border-neon-deep/55 bg-panel px-3 font-mono text-xs text-text-main placeholder:text-text-dim/60"
                  placeholder="https://example.com/tsian-game/"
                  @keyup.enter="saveFrontendBinding"
                />
              </label>

              <div v-if="frontendMode === 'packaged'" class="grid gap-2">
                <label class="grid gap-2">
                  <span class="font-mono text-[11px] uppercase tracking-wider text-neon-muted">入口文件</span>
                  <input
                    v-model="packagedEntry"
                    list="packaged-frontend-files"
                    type="text"
                    class="retro-focus h-9 border border-neon-deep/55 bg-panel px-3 font-mono text-xs text-text-main placeholder:text-text-dim/60"
                    placeholder="frontend/index.html"
                    @keyup.enter="saveFrontendBinding"
                  />
                </label>
                <datalist id="packaged-frontend-files">
                  <option
                    v-for="file in frontendFiles"
                    :key="file.path"
                    :value="file.path"
                  />
                </datalist>
              </div>

              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  class="retro-button retro-focus inline-flex h-9 items-center gap-2 px-3 font-mono text-xs"
                  :disabled="frontendSaving"
                  @click="saveFrontendBinding"
                >
                  <CheckCircle2 class="h-3.5 w-3.5" aria-hidden="true" />
                  保存绑定
                </button>
                <button
                  type="button"
                  class="retro-button retro-focus inline-flex h-9 items-center gap-2 px-3 font-mono text-xs text-danger"
                  :disabled="frontendSaving || !card?.manifest.frontend"
                  @click="clearFrontendBinding"
                >
                  <XCircle class="h-3.5 w-3.5" aria-hidden="true" />
                  清除绑定
                </button>
              </div>
            </section>

            <section class="grid content-start gap-3 border border-neon-deep/35 bg-elevated/35 p-3">
              <div class="flex items-center justify-between gap-2">
                <p class="font-mono text-xs uppercase tracking-wider text-neon">
                  Packaged 文件
                </p>
                <span class="font-mono text-[11px] text-text-dim">{{ frontendFiles.length }} 个</span>
              </div>
              <div v-if="frontendFiles.length === 0" class="border border-neon-deep/35 bg-panel/55 p-3 text-sm leading-6 text-text-dim">
                当前游戏卡没有存储打包前端文件。
              </div>
              <div v-else class="max-h-[340px] overflow-auto border border-neon-deep/35 bg-panel/55">
                <button
                  v-for="file in frontendFiles"
                  :key="file.path"
                  type="button"
                  class="retro-focus grid w-full grid-cols-[1fr_auto] gap-3 border-b border-neon-deep/20 px-3 py-2 text-left last:border-b-0 hover:bg-elevated"
                  @click="packagedEntry = file.path; frontendMode = 'packaged'"
                >
                  <span class="min-w-0">
                    <span class="block truncate font-mono text-xs text-text-main">{{ file.path }}</span>
                    <span class="mt-1 block truncate font-mono text-[11px] text-text-dim">{{ file.mediaType }}</span>
                  </span>
                  <span class="font-mono text-[11px] text-text-dim">{{ formatBytes(file.size) }}</span>
                </button>
              </div>
            </section>
          </div>
        </div>

        <div v-else class="retro-inset grid min-h-[360px] place-items-center p-6 text-center">
          <div class="max-w-md">
            <component :is="activePlaceholder.icon" class="mx-auto h-10 w-10 text-neon-muted" aria-hidden="true" />
            <h3 class="mt-4 text-lg font-bold text-text-main">
              {{ activePlaceholder.title }}
            </h3>
            <p class="mt-2 text-sm leading-6 text-text-dim">
              {{ activePlaceholder.copy }}
            </p>
          </div>
        </div>
      </div>

      <footer class="retro-statusbar flex min-h-9 flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
        <p class="font-mono text-[11px] text-text-dim">
          {{ frontendStatusLabel }}
        </p>
        <p class="min-w-0 truncate font-mono text-[11px] text-text-dim">
          当前存档：{{ activeSaveName }}
        </p>
      </footer>
  </section>
</template>

<script setup lang="ts">
import type { GameCardFrontendBinding } from "@tsian/contracts"
import { computed, onMounted, ref, watch } from "vue"
import { useRouter } from "vue-router"
import {
  Activity,
  ArrowLeft,
  Bot,
  CheckCircle2,
  Copy,
  Disc3,
  Download,
  ExternalLink,
  Gamepad2,
  Link2,
  MonitorCog,
  PackageOpen,
  Play,
  Plus,
  Save,
  Trash2,
  XCircle,
} from "lucide-vue-next"
import type { Component } from "vue"
import type { LocalGameCardRecord, LocalSaveRecord } from "@/storage/db"
import {
  formatDateTime,
  getFrontendStatusDescription,
  getFrontendStatusLabel,
  getGameCardAuthor,
  getGameCardCoverUrl,
  getGameCardDescription,
  getGameCardTitle,
  hasPlayableFrontend,
} from "@/lib/game-card-display"
import {
  copyPlatformGameCardAsLocal,
  createPlatformSaveFromGameCard,
  deletePlatformSave,
  exportPlatformGameCardPackage,
  getPlatformActiveSaveId,
  getPlatformGameCard,
  listPlatformGameCardFrontendFiles,
  listPlatformSaves,
  selectPlatformSave,
  updatePlatformGameCardMetadata,
  updatePlatformGameCardFrontend,
  type PlatformGameCardFrontendFileSummary,
} from "../platform-host"

type TabId = "overview" | "saves" | "frontend" | "agents" | "diagnostics"
type FrontendMode = "none" | "remote" | "packaged"

interface TabItem {
  id: TabId
  label: string
  icon: Component
}

const props = defineProps<{
  cardId: string
}>()

const router = useRouter()
const tabs: TabItem[] = [
  { id: "overview", label: "概览", icon: Disc3 },
  { id: "saves", label: "存档", icon: Save },
  { id: "frontend", label: "前端", icon: MonitorCog },
  { id: "agents", label: "Agent", icon: Bot },
  { id: "diagnostics", label: "诊断", icon: Activity },
]

const placeholders: Record<Exclude<TabId, "overview" | "saves">, { title: string, copy: string, icon: Component }> = {
  frontend: {
    title: "前端绑定稍后管理",
    copy: "这一页只展示当前前端状态，导入与绑定工具会在后续功能中开放。",
    icon: MonitorCog,
  },
  agents: {
    title: "Agent 与 Skill 管理预留中",
    copy: "游戏卡自带的 Agent 与 Skill 仍是可复用的游戏卡内容，不会复制进存档槽。",
    icon: Bot,
  },
  diagnostics: {
    title: "运行时诊断保留在诊断界面",
    copy: "面向存档的追踪与检查点仍属于运行时内部数据。",
    icon: Activity,
  },
}

const activeTab = ref<TabId>("overview")
const card = ref<LocalGameCardRecord | null>(null)
const allSaves = ref<LocalSaveRecord[]>([])
const activeSaveId = ref("")
const selectedSaveId = ref("")
const newSaveName = ref("")
const frontendFiles = ref<PlatformGameCardFrontendFileSummary[]>([])
const frontendMode = ref<FrontendMode>("none")
const remoteUrl = ref("")
const packagedEntry = ref("")
const metadataName = ref("")
const metadataVersion = ref("")
const metadataSummary = ref("")
const metadataDescription = ref("")
const metadataCopyId = ref("")
const loading = ref(false)
const exporting = ref(false)
const frontendSaving = ref(false)
const metadataSaving = ref(false)
const errorMessage = ref("")
const feedback = ref("")

const cardSaves = computed(() =>
  allSaves.value
    .filter((save) => save.gameCardId === card.value?.manifest.id)
    .sort((left, right) => right.updatedAt - left.updatedAt)
)

const cardTitle = computed(() => getGameCardTitle(card.value))
const cardDescription = computed(() => getGameCardDescription(card.value))
const cardAuthor = computed(() => getGameCardAuthor(card.value))
const coverUrl = computed(() => getGameCardCoverUrl(card.value))
const frontendStatusLabel = computed(() => getFrontendStatusLabel(card.value))
const frontendStatusDescription = computed(() => getFrontendStatusDescription(card.value))
const isPlayable = computed(() => hasPlayableFrontend(card.value))
const activeSaveName = computed(() =>
  allSaves.value.find((save) => save.id === activeSaveId.value)?.name ?? "无"
)
const activePlaceholder = computed(() => {
  if (activeTab.value === "overview" || activeTab.value === "saves") {
    return placeholders.frontend
  }
  return placeholders[activeTab.value]
})

function syncFrontendDraft(loadedCard: LocalGameCardRecord) {
  const frontend = loadedCard.manifest.frontend
  if (!frontend) {
    frontendMode.value = "none"
    remoteUrl.value = ""
    packagedEntry.value = frontendFiles.value.find((file) => file.path.endsWith(".html"))?.path
      ?? frontendFiles.value[0]?.path
      ?? ""
    return
  }

  if (frontend.kind === "remote") {
    frontendMode.value = "remote"
    remoteUrl.value = frontend.url
    return
  }

  frontendMode.value = "packaged"
  packagedEntry.value = frontend.entry
}

function defaultCopyId(loadedCard: LocalGameCardRecord): string {
  const base = loadedCard.id
    .replace(/^tsian\.builtin\./, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "game-card"
  return `local.${base}`
}

function syncMetadataDraft(loadedCard: LocalGameCardRecord) {
  metadataName.value = loadedCard.manifest.name
  metadataVersion.value = loadedCard.manifest.version
  metadataSummary.value = loadedCard.manifest.summary
  metadataDescription.value = loadedCard.manifest.description ?? ""
  metadataCopyId.value = defaultCopyId(loadedCard)
}

async function refreshData() {
  loading.value = true
  errorMessage.value = ""

  try {
    const [loadedCard, saves, loadedActiveSaveId, loadedFrontendFiles] = await Promise.all([
      getPlatformGameCard(props.cardId),
      listPlatformSaves(),
      getPlatformActiveSaveId(),
      listPlatformGameCardFrontendFiles(props.cardId),
    ])

    if (!loadedCard) {
      throw new Error(`未找到游戏卡「${props.cardId}」。`)
    }

    card.value = loadedCard
    allSaves.value = saves
    activeSaveId.value = loadedActiveSaveId ?? ""
    frontendFiles.value = loadedFrontendFiles
    syncFrontendDraft(loadedCard)
    syncMetadataDraft(loadedCard)

    const scopedSaves = saves.filter((save) => save.gameCardId === loadedCard.manifest.id)
    if (!scopedSaves.some((save) => save.id === selectedSaveId.value)) {
      selectedSaveId.value = scopedSaves.find((save) => save.id === activeSaveId.value)?.id
        ?? scopedSaves[0]?.id
        ?? ""
    }

  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "无法加载游戏卡详情。"
  } finally {
    loading.value = false
  }
}

function metadataInput() {
  return {
    name: metadataName.value,
    version: metadataVersion.value,
    summary: metadataSummary.value,
    description: metadataDescription.value,
  }
}

async function saveMetadata() {
  if (!card.value) {
    return
  }

  metadataSaving.value = true
  feedback.value = ""
  try {
    await updatePlatformGameCardMetadata(card.value.id, metadataInput())
    feedback.value = "已保存游戏卡属性。"
    await refreshData()
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : "保存游戏卡属性失败。"
  } finally {
    metadataSaving.value = false
  }
}

async function copyAsLocalCard() {
  if (!card.value) {
    return
  }

  metadataSaving.value = true
  feedback.value = ""
  try {
    const copied = await copyPlatformGameCardAsLocal(card.value.id, {
      id: metadataCopyId.value,
      ...metadataInput(),
    })
    feedback.value = `已创建本地副本：${copied.manifest.name}`
    router.push({ name: "game-card-detail", params: { cardId: copied.id } })
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : "创建本地副本失败。"
  } finally {
    metadataSaving.value = false
  }
}

function packageFilename(): string {
  const name = cardTitle.value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "game-card"
  const version = card.value?.manifest.version?.trim()
  return `${name}${version ? `-${version}` : ""}.tsian-card.zip`
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.rel = "noopener"
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

async function exportCard() {
  if (!card.value) {
    return
  }

  exporting.value = true
  feedback.value = ""
  try {
    const blob = await exportPlatformGameCardPackage(card.value.id)
    downloadBlob(blob, packageFilename())
    feedback.value = `已导出卡包：${packageFilename()}`
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : "导出游戏卡包失败。"
  } finally {
    exporting.value = false
  }
}

function frontendBindingDraft(): GameCardFrontendBinding | undefined {
  if (frontendMode.value === "none") {
    return undefined
  }

  if (frontendMode.value === "remote") {
    return {
      kind: "remote",
      url: remoteUrl.value,
      bridgeVersion: "tsian.play-bridge.v1",
    }
  }

  return {
    kind: "packaged",
    entry: packagedEntry.value,
    bridgeVersion: "tsian.play-bridge.v1",
  }
}

async function saveFrontendBinding() {
  if (!card.value) {
    return
  }

  frontendSaving.value = true
  feedback.value = ""
  try {
    const updated = await updatePlatformGameCardFrontend(card.value.id, frontendBindingDraft())
    feedback.value = updated.manifest.frontend
      ? "已保存前端绑定。"
      : "已清除前端绑定。"
    await refreshData()
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : "保存前端绑定失败。"
  } finally {
    frontendSaving.value = false
  }
}

async function clearFrontendBinding() {
  if (!card.value?.manifest.frontend) {
    return
  }
  const confirmed = window.confirm("清除这张游戏卡的前端绑定？游戏卡内容、存档和打包前端文件都会保留。")
  if (!confirmed) {
    return
  }

  frontendMode.value = "none"
  await saveFrontendBinding()
}

async function openPlayFromCard() {
  if (!isPlayable.value) {
    feedback.value = "这张游戏卡还没有可游玩的前端。"
    return
  }
  if (!selectedSaveId.value) {
    feedback.value = "请先创建或选择一个存档槽。"
    return
  }

  await continueSave(selectedSaveId.value)
}

function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) {
    return "0 B"
  }
  if (size < 1024) {
    return `${size} B`
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

async function createSave() {
  if (!card.value) {
    return
  }

  const created = await createPlatformSaveFromGameCard(card.value.id, {
    name: newSaveName.value || `${cardTitle.value} 存档 ${cardSaves.value.length + 1}`,
  })
  newSaveName.value = ""
  selectedSaveId.value = created.id
  feedback.value = `已创建存档槽：${created.name}`
  await refreshData()
}

async function selectSave(saveId: string) {
  await selectPlatformSave(saveId)
  selectedSaveId.value = saveId
  feedback.value = "已选择存档槽。"
  await refreshData()
}

async function continueSave(saveId: string) {
  if (!isPlayable.value) {
    feedback.value = "这张游戏卡还没有可游玩的前端。"
    return
  }

  await selectPlatformSave(saveId)
  router.push("/play")
}

async function deleteSave(saveId: string) {
  const save = allSaves.value.find((item) => item.id === saveId)
  const saveName = save?.name ?? "这个存档槽"
  const confirmed = window.confirm(
    `删除存档槽「${saveName}」？\n\n可复用的游戏卡「${cardTitle.value}」不会被删除。`,
  )
  if (!confirmed) {
    return
  }

  await deletePlatformSave(saveId)
  feedback.value = `已删除存档槽：${saveName}`
  if (selectedSaveId.value === saveId) {
    selectedSaveId.value = ""
  }
  await refreshData()
}

watch(() => props.cardId, () => {
  activeTab.value = "overview"
  void refreshData()
})

onMounted(() => {
  void refreshData()
})
</script>

<style scoped>
.poster-pane {
  box-shadow:
    inset 1px 1px 0 rgba(0, 0, 0, 0.72),
    inset -1px -1px 0 rgba(246, 236, 215, 0.1);
}

.slot-row {
  box-shadow:
    inset 1px 1px 0 rgba(246, 236, 215, 0.1),
    inset -1px -1px 0 rgba(0, 0, 0, 0.55);
}
</style>
