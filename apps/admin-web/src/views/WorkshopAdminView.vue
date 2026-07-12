<template>
  <section class="panel panel--split">
    <header class="panel-header">
      <div>
        <p class="eyebrow">Workshop</p>
        <h2>创意工坊资源</h2>
      </div>
      <button type="button" class="button" :disabled="loading" @click="loadPackages">
        {{ loading ? "刷新中…" : "刷新" }}
      </button>
    </header>

    <div class="filters">
      <label>
        <span>搜索</span>
        <input v-model="filters.q" type="search" placeholder="标题 / 简介 / 资源 ID" @keydown.enter="loadPackages" />
      </label>
      <label>
        <span>类型</span>
        <select v-model="filters.resourceType" @change="loadPackages">
          <option value="">全部</option>
          <option value="game_card">游戏卡</option>
          <option value="agent">Agent</option>
          <option value="skill">Skill</option>
          <option value="tool">Tool</option>
        </select>
      </label>
      <label>
        <span>状态</span>
        <select v-model="filters.visibility" @change="loadPackages">
          <option value="all">全部</option>
          <option value="visible">公开</option>
          <option value="hidden">已下架</option>
        </select>
      </label>
      <label>
        <span>上传者</span>
        <input v-model="filters.uploader" type="search" placeholder="ID / 昵称" @keydown.enter="loadPackages" />
      </label>
    </div>

    <p v-if="feedback" class="feedback">{{ feedback }}</p>
    <p v-if="errorMessage" class="feedback feedback--error">{{ errorMessage }}</p>

    <div class="content-grid">
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>类型</th>
              <th>标题</th>
              <th>上传者</th>
              <th>下载</th>
              <th>状态</th>
              <th>更新</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="packages.length === 0">
              <td colspan="6" class="empty-cell">暂无资源</td>
            </tr>
            <tr
              v-for="pkg in packages"
              :key="pkg.id"
              :class="{ selected: selected?.id === pkg.id }"
              @click="selectPackage(pkg)"
            >
              <td>{{ resourceTypeLabel(pkg.resourceType) }}</td>
              <td>
                <strong>{{ pkg.name }}</strong>
                <small>{{ pkg.resourceId }}</small>
              </td>
              <td>
                {{ pkg.uploader.displayName }}
                <small>{{ pkg.uploader.id }}</small>
              </td>
              <td>{{ pkg.downloadCount }}</td>
              <td>
                <span :class="['state-pill', pkg.hiddenAt ? 'state-pill--hidden' : 'state-pill--visible']">
                  {{ pkg.hiddenAt ? "已下架" : "公开" }}
                </span>
              </td>
              <td>{{ formatTime(pkg.updatedAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <aside class="detail-panel">
        <template v-if="selected">
          <header class="detail-header">
            <div>
              <p class="eyebrow">Resource Detail</p>
              <h3>{{ selected.name }}</h3>
            </div>
            <span :class="['state-pill', selected.hiddenAt ? 'state-pill--hidden' : 'state-pill--visible']">
              {{ selected.hiddenAt ? "已下架" : "公开" }}
            </span>
          </header>

          <div class="form-grid">
            <label>
              <span>标题</span>
              <input v-model="draft.name" />
            </label>
            <label>
              <span>简介</span>
              <textarea v-model="draft.summary" rows="5" />
            </label>
            <label>
              <span>Tags（逗号分隔）</span>
              <input v-model="draft.tagsText" />
            </label>
          </div>

          <div class="action-row">
            <button type="button" class="button" :disabled="saving" @click="saveMetadata">
              {{ saving ? "保存中…" : "保存元数据" }}
            </button>
            <button v-if="selected.hiddenAt" type="button" class="button" :disabled="saving" @click="unhideSelected">恢复公开</button>
            <button v-else type="button" class="button" :disabled="saving" @click="hideSelected">下架资源</button>
          </div>

          <section class="danger-zone">
            <h4>危险区</h4>
            <p>永久删除会移除资源记录和已上传文件，无法恢复。通常请优先使用“下架”。</p>
            <button type="button" class="button button--danger" :disabled="saving" @click="deleteSelected">永久删除</button>
          </section>
        </template>
        <p v-else class="muted">选择一条资源查看详情和操作。</p>
      </aside>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue"
import type { AdminMarketPackage, AdminMarketVisibility, MarketResourceType } from "@tsian/contracts"
import { adminMarketApi } from "../api-client"
import { confirm } from "@/composables/useConfirm"

const packages = ref<AdminMarketPackage[]>([])
const selected = ref<AdminMarketPackage | null>(null)
const loading = ref(false)
const saving = ref(false)
const feedback = ref("")
const errorMessage = ref("")

const filters = reactive<{
  q: string
  resourceType: MarketResourceType | ""
  visibility: AdminMarketVisibility
  uploader: string
}>({
  q: "",
  resourceType: "",
  visibility: "all",
  uploader: "",
})

const draft = reactive({
  name: "",
  summary: "",
  tagsText: "",
})

onMounted(loadPackages)

async function loadPackages(): Promise<void> {
  loading.value = true
  errorMessage.value = ""
  try {
    const response = await adminMarketApi.list({
      q: filters.q.trim(),
      resourceType: filters.resourceType,
      visibility: filters.visibility,
      uploader: filters.uploader.trim(),
      limit: 100,
    })
    packages.value = response.packages
    if (selected.value) {
      selected.value = packages.value.find((pkg) => pkg.id === selected.value?.id) ?? null
      if (selected.value) fillDraft(selected.value)
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "资源加载失败"
  } finally {
    loading.value = false
  }
}

function selectPackage(pkg: AdminMarketPackage): void {
  selected.value = pkg
  fillDraft(pkg)
  feedback.value = ""
  errorMessage.value = ""
}

function fillDraft(pkg: AdminMarketPackage): void {
  draft.name = pkg.name
  draft.summary = pkg.summary
  draft.tagsText = pkg.tags.join(", ")
}

async function saveMetadata(): Promise<void> {
  if (!selected.value) return
  saving.value = true
  feedback.value = ""
  errorMessage.value = ""
  try {
    const updated = await adminMarketApi.update(selected.value.id, {
      name: draft.name.trim(),
      summary: draft.summary.trim(),
      tags: parseTags(draft.tagsText),
    })
    replacePackage(updated)
    feedback.value = "元数据已保存。"
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "保存失败"
  } finally {
    saving.value = false
  }
}

async function hideSelected(): Promise<void> {
  if (!selected.value) return
  const confirmed = await confirm({
    title: "下架资源",
    message: "确认下架该资源？下架后普通用户将无法查看或下载，但管理员仍可恢复。",
    confirmText: "下架资源",
  })
  if (!confirmed) return
  await mutateSelected(() => adminMarketApi.hide(selected.value!.id), "资源已下架。")
}

async function unhideSelected(): Promise<void> {
  if (!selected.value) return
  await mutateSelected(() => adminMarketApi.unhide(selected.value!.id), "资源已恢复公开。")
}

async function deleteSelected(): Promise<void> {
  if (!selected.value) return
  const confirmed = await confirm({
    title: "永久删除资源",
    message: "永久删除会移除资源记录和已上传文件，无法恢复。确认删除该资源？",
    confirmText: "永久删除",
    severity: "danger",
  })
  if (!confirmed) return
  saving.value = true
  feedback.value = ""
  errorMessage.value = ""
  try {
    const id = selected.value.id
    await adminMarketApi.delete(id)
    packages.value = packages.value.filter((pkg) => pkg.id !== id)
    selected.value = null
    feedback.value = "资源已永久删除。"
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "删除失败"
  } finally {
    saving.value = false
  }
}

async function mutateSelected(action: () => Promise<AdminMarketPackage>, message: string): Promise<void> {
  saving.value = true
  feedback.value = ""
  errorMessage.value = ""
  try {
    const updated = await action()
    replacePackage(updated)
    feedback.value = message
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "操作失败"
  } finally {
    saving.value = false
  }
}

function replacePackage(updated: AdminMarketPackage): void {
  packages.value = packages.value.map((pkg) => (pkg.id === updated.id ? updated : pkg))
  selected.value = updated
  fillDraft(updated)
}

function parseTags(value: string): string[] {
  return value.split(",").map((tag) => tag.trim()).filter(Boolean)
}

function resourceTypeLabel(type: MarketResourceType): string {
  switch (type) {
    case "agent": return "Agent"
    case "skill": return "Skill"
    case "tool": return "Tool"
    case "game_card":
    default: return "游戏卡"
  }
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date)
}
</script>
