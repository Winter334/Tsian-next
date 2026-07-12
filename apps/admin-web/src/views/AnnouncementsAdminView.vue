<template>
  <section class="panel panel--split">
    <header class="panel-header">
      <div>
        <p class="eyebrow">Announcements</p>
        <h2>公告管理</h2>
      </div>
      <button type="button" class="button" @click="createNew">新建公告</button>
    </header>

    <p v-if="feedback" class="feedback">{{ feedback }}</p>
    <p v-if="errorMessage" class="feedback feedback--error">{{ errorMessage }}</p>

    <div class="announcement-workbench">
      <aside class="list-panel announcement-list-panel">
        <div class="list-panel__header">
          <div>
            <strong>公告列表</strong>
            <small>{{ announcements.length }} 条公告</small>
          </div>
          <button type="button" class="text-link" :disabled="loading" @click="loadAnnouncements">
            {{ loading ? "刷新中…" : "刷新" }}
          </button>
        </div>
        <button
          v-for="item in announcements"
          :key="item.id"
          type="button"
          :class="['list-item', 'announcement-list-item', { 'list-item--active': selected?.id === item.id }]"
          @click="selectAnnouncement(item)"
        >
          <strong>{{ item.title }}</strong>
          <small>更新 {{ formatTime(item.updatedAt) }}</small>
        </button>
        <p v-if="announcements.length === 0" class="muted list-empty">暂无公告</p>
      </aside>

      <article class="detail-panel announcement-editor-panel">
        <template v-if="editing">
          <header class="detail-header">
            <div>
              <p class="eyebrow">Editor</p>
              <h3>{{ selected ? "编辑公告" : "新建公告" }}</h3>
            </div>
            <span v-if="selected" class="muted editor-meta">更新于 {{ formatTime(selected.updatedAt) }}</span>
          </header>

          <label class="title-field">
            <span>标题</span>
            <input v-model="draft.title" maxlength="120" placeholder="公告标题" />
          </label>

          <div class="announcement-editor-grid">
            <label class="markdown-field">
              <span>正文（Markdown）</span>
              <textarea v-model="draft.body" rows="24" placeholder="支持标题、列表、链接、表格和代码块" />
            </label>

            <section class="preview-panel announcement-preview-panel">
              <p class="eyebrow">Preview</p>
              <h4>预览</h4>
              <div v-if="draft.body.trim()" class="announcement-prose" v-html="renderAnnouncementMarkdown(draft.body)" />
              <p v-else class="muted">正文预览会显示在这里。</p>
            </section>
          </div>

          <div class="action-row announcement-actions">
            <button type="button" class="button" :disabled="saving" @click="saveAnnouncement">
              {{ saving ? "保存中…" : selected ? "保存公告" : "发布公告" }}
            </button>
            <button type="button" class="button" @click="cancelEdit">取消</button>
          </div>

          <section v-if="selected" class="danger-zone announcement-danger-zone">
            <div>
              <h4>危险区</h4>
              <p>删除公告后玩家端不再显示，无法恢复。</p>
            </div>
            <button type="button" class="button button--danger" :disabled="saving" @click="deleteAnnouncement">删除公告</button>
          </section>
        </template>
        <div v-else class="empty-editor-state">
          <p class="eyebrow">Editor</p>
          <h3>选择公告开始编辑</h3>
          <p class="muted">从左侧列表选择已有公告，或点击“新建公告”发布新的 Markdown 公告。</p>
          <button type="button" class="button" @click="createNew">新建公告</button>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue"
import type { Announcement } from "@tsian/contracts"
import { renderAnnouncementMarkdown } from "@tsian/web-utils"
import { adminAnnouncementsApi } from "../api-client"
import { confirm } from "@/composables/useConfirm"

const announcements = ref<Announcement[]>([])
const selected = ref<Announcement | null>(null)
const editing = ref(false)
const loading = ref(false)
const saving = ref(false)
const feedback = ref("")
const errorMessage = ref("")
const draft = reactive({ title: "", body: "" })

onMounted(loadAnnouncements)

async function loadAnnouncements(): Promise<void> {
  loading.value = true
  errorMessage.value = ""
  try {
    announcements.value = await adminAnnouncementsApi.list()
    if (selected.value) {
      selected.value = announcements.value.find((item) => item.id === selected.value?.id) ?? null
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "公告加载失败"
  } finally {
    loading.value = false
  }
}

function createNew(): void {
  selected.value = null
  draft.title = ""
  draft.body = ""
  editing.value = true
  feedback.value = ""
  errorMessage.value = ""
}

function selectAnnouncement(item: Announcement): void {
  selected.value = item
  draft.title = item.title
  draft.body = item.body
  editing.value = true
  feedback.value = ""
  errorMessage.value = ""
}

function cancelEdit(): void {
  editing.value = false
  selected.value = null
  draft.title = ""
  draft.body = ""
}

async function saveAnnouncement(): Promise<void> {
  saving.value = true
  feedback.value = ""
  errorMessage.value = ""
  try {
    const input = { title: draft.title.trim(), body: draft.body.trim() }
    const selectedAnnouncement = selected.value
    const isUpdate = selectedAnnouncement !== null
    const saved = selectedAnnouncement
      ? await adminAnnouncementsApi.update(selectedAnnouncement.id, input)
      : await adminAnnouncementsApi.create(input)
    upsertAnnouncement(saved)
    selected.value = saved
    draft.title = saved.title
    draft.body = saved.body
    editing.value = true
    feedback.value = isUpdate ? "公告已保存。" : "公告已发布。"
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "公告保存失败"
  } finally {
    saving.value = false
  }
}

async function deleteAnnouncement(): Promise<void> {
  if (!selected.value) return
  const confirmed = await confirm({
    title: "删除公告",
    message: "确认删除该公告？删除后玩家端不再显示，且无法恢复。",
    confirmText: "删除公告",
    severity: "danger",
  })
  if (!confirmed) return
  saving.value = true
  feedback.value = ""
  errorMessage.value = ""
  try {
    const id = selected.value.id
    await adminAnnouncementsApi.delete(id)
    announcements.value = announcements.value.filter((item) => item.id !== id)
    cancelEdit()
    feedback.value = "公告已删除。"
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "公告删除失败"
  } finally {
    saving.value = false
  }
}

function upsertAnnouncement(item: Announcement): void {
  const index = announcements.value.findIndex((candidate) => candidate.id === item.id)
  if (index >= 0) {
    announcements.value.splice(index, 1, item)
  } else {
    announcements.value.unshift(item)
  }
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date)
}
</script>
