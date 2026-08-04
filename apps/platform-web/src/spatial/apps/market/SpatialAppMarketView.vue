<template>
  <section class="spatial-app spatial-market" data-spatial-source-animation aria-label="创意工坊">
    <header class="spatial-app__header">
      <div class="spatial-app__identity">
        <span class="spatial-app__eyebrow">COMMUNITY RESOURCES</span>
        <h1>{{ screen.kind === "list" ? "创意工坊" : screen.kind === "detail" ? detailPackage?.name || "资源详情" : "上传资源" }}</h1>
      </div>
      <div class="spatial-app__commands">
        <SpatialActionButton v-if="screen.kind !== 'list'" icon-only aria-label="返回列表" @click="leaveScreen"><template #icon><ArrowLeft /></template></SpatialActionButton>
        <SpatialActionButton variant="primary" @click="openSpatialUpload"><template #icon><Upload /></template>上传资源</SpatialActionButton>
        <SpatialSelect
          v-if="screen.kind === 'list'"
          class="spatial-market__sort"
          :model-value="sortMode"
          :options="sortOptions"
          aria-label="排序"
          @update:model-value="changeSortMode"
        />
      </div>
    </header>

    <div class="spatial-market__body">
      <aside class="spatial-market__rail" aria-label="资源类型">
        <SpatialActionButton
          v-for="option in resourceTypeOptions"
          :key="option.type"
          :aria-pressed="currentType === option.type"
          @click="switchType(option.type)"
        >
          <template #icon><component :is="option.icon" /></template>
          <strong>{{ option.label }}</strong><small>{{ resourceCounts[option.type] ?? 0 }} 项</small>
        </SpatialActionButton>
        <SpatialActionButton class="spatial-market__scope" :aria-pressed="marketScope === 'mine'" @click="toggleMarketScope">
          <template #icon><UserRound /></template><strong>{{ marketScope === "mine" ? "我的上传" : "全部资源" }}</strong><small>切换范围</small>
        </SpatialActionButton>
      </aside>

      <main class="spatial-app__scroll spatial-market__content">
        <div class="spatial-transition-stack">
          <div :key="screen.kind" class="spatial-market__screen">
              <template v-if="screen.kind === 'list'">
          <div class="spatial-market__filters">
            <label class="spatial-app__field"><span>搜索</span><input v-model="searchQuery" type="search" placeholder="名称、简介" @input="onSearchInput" /></label>
            <label class="spatial-app__field"><span>Tag</span><input v-model="tagQuery" type="search" placeholder="tag" @input="onTagInput" /></label>
            <label class="spatial-app__field spatial-market__compact-type"><span>资源类型</span>
              <SpatialSelect
                :model-value="currentType"
                :options="compactTypeOptions"
                aria-label="资源类型"
                @update:model-value="changeCompactType"
              />
            </label>
            <SpatialActionButton class="spatial-market__compact-scope" @click="toggleMarketScope">
              {{ marketScope === "mine" ? "显示全部资源" : "显示我的上传" }}
            </SpatialActionButton>
          </div>

          <div v-if="marketScope === 'mine' && !loggedIn" class="spatial-app__empty spatial-market__center">
            <UserRound aria-hidden="true" /><strong>登录后管理你的发布物</strong>
            <SpatialActionButton variant="primary" @click="openAccountCenter">打开账号中心</SpatialActionButton>
          </div>
          <div v-else-if="loading" class="spatial-app__empty" role="status">正在加载创意工坊…</div>
          <div v-else-if="packages.length === 0" class="spatial-app__empty spatial-market__center">
            <Store aria-hidden="true" /><strong>{{ emptyMessage }}</strong>
          </div>
          <TransitionGroup v-else name="spatial-list" tag="div" appear class="spatial-market__grid" role="group" aria-label="创意工坊资源">
            <button v-for="(pkg, index) in packages" :key="pkg.id" class="spatial-market-card" type="button" :style="{ '--spatial-entry-index': Math.min(index, 5) }" @click="openDetail(pkg.id)">
              <div class="spatial-market-card__cover">
                <SpatialImage :source="packageSources[pkg.id]" :alt="pkg.name" :icon="resourceIcon(pkg.resourceType)" :fallback-label="`${resourceLabel(pkg.resourceType)} 图像不可用`" />
              </div>
              <span class="spatial-app__eyebrow">{{ resourceLabel(pkg.resourceType) }} · v{{ pkg.resourceVersion || "-" }}</span>
              <strong>{{ pkg.name }}</strong>
              <p>{{ pkg.summary || "暂无简介" }}</p>
              <span class="spatial-app__meta">{{ pkg.downloadCount }} 次下载 · {{ pkg.uploader.displayName }}</span>
            </button>
          </TransitionGroup>
          <div v-if="packages.length" class="spatial-market__load-more">
            <SpatialActionButton v-if="nextCursor" :disabled="loadingMore" @click="loadMore">{{ loadingMore ? "加载中…" : "加载更多" }}</SpatialActionButton>
            <span v-else class="spatial-app__meta">已全部加载</span>
          </div>
              </template>

              <template v-else-if="screen.kind === 'detail'">
          <div v-if="detailLoading" class="spatial-app__empty" role="status">正在加载资源详情…</div>
          <div v-else-if="!detailPackage" class="spatial-app__empty">资源不存在或已被删除。</div>
          <div v-else class="spatial-market-detail">
            <section class="spatial-app__section spatial-market-detail__hero">
              <div class="spatial-market-detail__cover"><SpatialImage :source="detailSource" :alt="detailPackage.name" :icon="resourceIcon(detailPackage.resourceType)" fallback-label="资源图像不可用" /></div>
              <div class="spatial-market-detail__summary">
                <span class="spatial-app__eyebrow">{{ resourceLabel(detailPackage.resourceType) }} · {{ detailPackage.resourceId }}</span>
                <h2>{{ detailPackage.name }}</h2>
                <p>{{ detailPackage.summary || "暂无简介" }}</p>
                <div class="spatial-app__tags"><span v-for="tag in detailPackage.tags" :key="tag">#{{ tag }}</span></div>
                <dl>
                  <div><dt>作者</dt><dd>{{ detailPackage.resourceAuthor || "未知" }}</dd></div>
                  <div><dt>版本</dt><dd>{{ detailPackage.resourceVersion || "-" }}</dd></div>
                  <div><dt>下载</dt><dd>{{ detailPackage.downloadCount }}</dd></div>
                </dl>
                <div class="spatial-app__actions">
                  <SpatialActionButton variant="primary" :disabled="installing" @click="openInstallDialog(detailPackage)">
                    <template #icon><Download /></template>{{ installing ? "安装中…" : "下载并安装" }}
                  </SpatialActionButton>
                  <SpatialActionButton v-if="canManageDetail && !editing" @click="beginEdit"><template #icon><Pencil /></template>编辑发布</SpatialActionButton>
                  <SpatialActionButton v-if="canManageDetail && !editing" variant="danger" :disabled="deletingPackage" @click="handleDeletePackage(detailPackage)"><template #icon><Trash2 /></template>删除</SpatialActionButton>
                </div>
              </div>
            </section>

            <form v-if="editing" class="spatial-app__section spatial-market__form" @submit.prevent="saveEdit">
              <div class="spatial-market__section-heading"><h2>编辑发布</h2><SpatialActionButton @click="cancelEdit">取消</SpatialActionButton></div>
              <div class="spatial-market__field-grid">
                <label class="spatial-app__field"><span>标题</span><input v-model="editDraft.title" required type="text" /></label>
                <label class="spatial-app__field"><span>作者</span><input v-model="editDraft.author" type="text" /></label>
              </div>
              <label class="spatial-app__field"><span>简介</span><textarea v-model="editDraft.summary" rows="3" /></label>
              <label class="spatial-app__field"><span>Tags（逗号分隔）</span><input v-model="editDraft.tags" type="text" /></label>
              <div class="spatial-market__replacement">
                <span><strong>替换包内容</strong><small>{{ replacementLabel || "沿用当前包" }}</small></span>
                <SpatialActionButton @click="showReplacementDialog">选择本地资源</SpatialActionButton>
                <SpatialActionButton v-if="replacementLabel" @click="clearReplacement">清除替换</SpatialActionButton>
              </div>
              <label v-if="replacementLabel" class="spatial-app__field"><span>替换包版本</span><input v-model="editDraft.version" required type="text" /></label>
              <SpatialActionButton type="submit" variant="primary" :disabled="updatingPackage">{{ updatingPackage ? "保存中…" : "保存发布" }}</SpatialActionButton>
            </form>
          </div>
              </template>

              <template v-else>
          <div v-if="!loggedIn" class="spatial-app__empty spatial-market__center">
            <UserRound aria-hidden="true" /><strong>上传资源需要先登录</strong>
            <SpatialActionButton variant="primary" @click="openAccountCenter">打开账号中心</SpatialActionButton>
          </div>
          <div v-else class="spatial-market-upload">
            <section class="spatial-app__section">
              <div class="spatial-app__segments" role="group" aria-label="上传资源类型">
                <button v-for="option in resourceTypeOptions" :key="option.type" class="spatial-app__segment" type="button" :aria-pressed="uploadType === option.type" @click="selectUploadType(option.type)">{{ option.label }}</button>
              </div>
            </section>
            <div v-if="localResourcesLoading" class="spatial-app__empty" role="status">正在读取本地资源…</div>
            <div v-else-if="uploadItems.length === 0" class="spatial-app__empty">没有可上传的{{ resourceLabel(uploadType) }}。</div>
            <div v-else class="spatial-market__upload-items" role="group" :aria-label="`可上传的${resourceLabel(uploadType)}`">
              <button v-for="item in uploadItems" :key="item.key" type="button" :aria-pressed="uploadSelection?.key === item.key" @click="selectUploadItem(item)">
                <SpatialImage v-if="item.source" :source="item.source" :alt="item.label" :icon="resourceIcon(uploadType)" fallback-label="资源图像不可用" />
                <component :is="resourceIcon(uploadType)" v-else aria-hidden="true" />
                <span><strong>{{ item.label }}</strong><small>{{ item.summary || item.resourceId }}</small></span>
              </button>
            </div>
            <form v-if="uploadSelection" class="spatial-app__section spatial-market__form" @submit.prevent="submitUpload">
              <h2>上传信息</h2>
              <div class="spatial-market__field-grid">
                <label class="spatial-app__field"><span>标题</span><input v-model="uploadDraft.title" type="text" /></label>
                <label class="spatial-app__field"><span>版本</span><input v-model="uploadDraft.version" required type="text" /></label>
              </div>
              <label class="spatial-app__field"><span>作者</span><input v-model="uploadDraft.author" type="text" /></label>
              <label class="spatial-app__field"><span>简介</span><textarea v-model="uploadDraft.summary" rows="3" /></label>
              <label class="spatial-app__field"><span>Tags（逗号分隔）</span><input v-model="uploadDraft.tags" type="text" /></label>
              <SpatialActionButton type="submit" variant="primary" :disabled="uploading">{{ uploading ? "上传中…" : "确认上传" }}</SpatialActionButton>
            </form>
          </div>
              </template>
          </div>
        </div>

        <p v-if="feedback" class="spatial-app__banner" role="status">{{ feedback }}</p>
        <p v-if="errorMessage" class="spatial-app__banner spatial-app__banner--error" role="alert">{{ errorMessage }}</p>
      </main>
    </div>

    <Transition name="spatial-dialog">
      <div v-if="installDialog" class="spatial-app__dialog-backdrop" @click.self="closeInstallDialog">
        <section ref="installDialogElement" class="spatial-app__dialog" role="dialog" aria-modal="true" aria-label="选择安装目标" tabindex="-1" @keydown.esc.stop.prevent="closeInstallDialog">
          <div class="spatial-market__section-heading"><div><h2>安装 {{ installDialog.pkg.name }}</h2><p>选择资源写入位置。</p></div><SpatialActionButton icon-only :disabled="installing" aria-label="关闭" @click="closeInstallDialog"><template #icon><X /></template></SpatialActionButton></div>
          <button v-for="option in installDialog.options" :key="option.key" class="spatial-market__target" type="button" :disabled="installing" @click="selectInstallTarget(option)">
            <strong>{{ option.label }}</strong><span>{{ option.description }}</span><small v-if="option.requiresConfirm">需要替换确认</small>
          </button>
          <p v-if="installDialog.options.length === 0" class="spatial-app__empty">当前没有可用安装目标。</p>
        </section>
      </div>
    </Transition>

    <Transition name="spatial-dialog">
      <div v-if="replacementDialogOpen && detailPackage" class="spatial-app__dialog-backdrop" @click.self="closeReplacementDialog">
        <section ref="replacementDialogElement" class="spatial-app__dialog" role="dialog" aria-modal="true" aria-label="选择替换资源" tabindex="-1" @keydown.esc.stop.prevent="closeReplacementDialog">
          <div class="spatial-market__section-heading"><div><h2>替换包内容</h2><p>只显示同类型本地资源。</p></div><SpatialActionButton icon-only aria-label="关闭" @click="closeReplacementDialog"><template #icon><X /></template></SpatialActionButton></div>
          <div v-if="localResourcesLoading" class="spatial-app__empty">正在读取本地资源…</div>
          <button v-for="item in replacementItems" v-else :key="item.key" class="spatial-market__target" type="button" @click="chooseReplacement(item)">
            <strong>{{ item.label }}</strong><span>{{ item.summary || item.resourceId }}</span>
          </button>
          <p v-if="!localResourcesLoading && replacementItems.length === 0" class="spatial-app__empty">没有可替换的本地资源。</p>
        </section>
      </div>
    </Transition>
  </section>
</template>

<script setup lang="ts">
import type { MarketPackage, MarketResourceType } from "@tsian/contracts"
import { computed, nextTick, ref, watch } from "vue"
import { ArrowLeft, Download, Pencil, Store, Trash2, Upload, UserRound, X } from "lucide-vue-next"
import type { MarketUploadMetadata, MarketUploadSelectionPayload, MarketUploadSubmitPayload } from "@/components/market/types"
import { useAppMarketController } from "@/controllers/market/use-app-market-controller"
import type { LocalGameCardView } from "@/storage/game-cards"
import SpatialImage from "../media/SpatialImage.vue"
import { spatialImageInputForGameCard, type SpatialImageInput } from "../media/spatial-image"
import SpatialActionButton from "../primitives/SpatialActionButton.vue"
import SpatialSelect from "../primitives/SpatialSelect.vue"
import type { SpatialSelectOption } from "../primitives/spatial-select"
import "../spatial-apps.css"

interface SpatialUploadItem {
  key: string
  label: string
  summary: string
  resourceId: string
  selection: MarketUploadSelectionPayload
  source?: SpatialImageInput
}

interface UploadDraft {
  title: string
  summary: string
  author: string
  version: string
  tags: string
}

const {
  screen,
  marketScope,
  currentType,
  packages,
  resourceCounts,
  loading,
  loadingMore,
  nextCursor,
  searchQuery,
  tagQuery,
  sortMode,
  detailPackage,
  detailLoading,
  errorMessage,
  emptyMessage,
  refresh,
  loadMore,
  onSearchInput,
  onTagInput,
  switchType,
  toggleMarketScope,
  openDetail,
  goBack,
  uploadCards,
  localResourcesLoading,
  agentUploadOptions,
  skillUploadOptions,
  toolUploadOptions,
  uploadMetadataDefaults,
  loggedIn,
  resourceTypeOptions,
  installing,
  uploading,
  feedback,
  installDialog,
  updatingPackage,
  deletingPackage,
  replacementDialogOpen,
  replacementDefaults,
  replacementLabel,
  canManageDetail,
  openUploadScreen,
  handleUpload,
  handleDownloadInstall,
  handleInstallTargetSelected,
  closeInstallDialog: dismissInstallDialog,
  startEditPackage,
  clearReplacement,
  openReplacementDialog: openControllerReplacementDialog,
  handleReplacementSelected,
  handleSavePackageEdit,
  handleDeletePackage,
  openAccountCenter,
} = useAppMarketController()

const uploadType = ref<MarketResourceType>(currentType.value)
const uploadSelection = ref<SpatialUploadItem | null>(null)
const uploadDraft = ref<UploadDraft>(emptyDraft())
const editing = ref(false)
const editDraft = ref<UploadDraft>(emptyDraft())
const installDialogElement = ref<HTMLElement | null>(null)
const replacementDialogElement = ref<HTMLElement | null>(null)
let installDialogInvoker: HTMLElement | null = null
let replacementDialogInvoker: HTMLElement | null = null
let selectingInstallTarget = false
const sortOptions = [
  { value: "newest", label: "最新" },
  { value: "downloads", label: "下载量" },
] satisfies readonly SpatialSelectOption[]

const packageSources = computed<Record<string, SpatialImageInput>>(() => Object.fromEntries(
  packages.value.map((pkg) => [pkg.id, pkg.coverThumbUrl ? { kind: "url", url: pkg.coverThumbUrl } : { kind: "none" }]),
))
const detailSource = computed<SpatialImageInput>(() => detailPackage.value?.coverUrl
  ? { kind: "url", url: detailPackage.value.coverUrl }
  : { kind: "none" })
const uploadItems = computed(() => itemsForType(uploadType.value))
const replacementItems = computed(() => detailPackage.value ? itemsForType(detailPackage.value.resourceType) : [])
const compactTypeOptions = computed<SpatialSelectOption[]>(() => resourceTypeOptions.map((option) => ({
  value: option.type,
  label: `${option.label} · ${resourceCounts.value[option.type] ?? 0}`,
})))

function itemsForType(type: MarketResourceType): SpatialUploadItem[] {
  if (type === "game_card") {
    return uploadCards.value.map((card: LocalGameCardView) => ({
      key: `card:${card.id}`,
      label: card.manifest.name || card.id,
      summary: card.manifest.summary,
      resourceId: card.manifest.id,
      selection: { resourceType: "game_card", cardId: card.id },
      source: spatialImageInputForGameCard(card),
    }))
  }
  const options = type === "agent" ? agentUploadOptions.value : type === "skill" ? skillUploadOptions.value : toolUploadOptions.value
  return options.map((option) => ({
    key: option.key,
    label: option.label,
    summary: option.summary,
    resourceId: option.resourceId,
    selection: { resourceType: type, source: option.source } as MarketUploadSelectionPayload,
  }))
}

function resourceOption(type: MarketResourceType) {
  return resourceTypeOptions.find((option) => option.type === type) ?? resourceTypeOptions[0]
}

function resourceIcon(type: MarketResourceType) {
  return resourceOption(type).icon
}

function resourceLabel(type: MarketResourceType): string {
  return resourceOption(type).label
}

function openSpatialUpload(): void {
  uploadType.value = currentType.value
  uploadSelection.value = null
  uploadDraft.value = emptyDraft()
  openUploadScreen()
}

function changeSortMode(value: string): void {
  if (value !== "newest" && value !== "downloads") return
  sortMode.value = value
  void refresh()
}

function changeCompactType(value: string): void {
  if (isMarketResourceType(value)) switchType(value)
}

function isMarketResourceType(value: string): value is MarketResourceType {
  return resourceTypeOptions.some((option) => option.type === value)
}

function leaveScreen(): void {
  editing.value = false
  clearReplacement()
  goBack()
}

function selectUploadType(type: MarketResourceType): void {
  uploadType.value = type
  uploadSelection.value = null
  uploadDraft.value = emptyDraft()
}

function selectUploadItem(item: SpatialUploadItem): void {
  uploadSelection.value = item
  uploadDraft.value = draftFromMetadata(uploadMetadataDefaults(item.selection))
}

async function submitUpload(): Promise<void> {
  const selected = uploadSelection.value
  if (!selected || !uploadDraft.value.version.trim()) {
    errorMessage.value = "版本不能为空。"
    return
  }
  await handleUpload({
    ...selected.selection,
    title: optional(uploadDraft.value.title),
    summary: optional(uploadDraft.value.summary),
    author: optional(uploadDraft.value.author),
    version: uploadDraft.value.version.trim(),
    tags: optional(uploadDraft.value.tags),
  } as MarketUploadSubmitPayload)
}

function beginEdit(): void {
  const pkg = detailPackage.value
  if (!pkg) return
  startEditPackage()
  editing.value = true
  editDraft.value = {
    title: pkg.name,
    summary: pkg.summary,
    author: pkg.resourceAuthor,
    version: pkg.resourceVersion,
    tags: pkg.tags.join(", "),
  }
}

async function openInstallDialog(pkg: MarketPackage): Promise<void> {
  installDialogInvoker = activeElement()
  await handleDownloadInstall(pkg)
  if (!installDialog.value) installDialogInvoker = null
}

async function selectInstallTarget(option: NonNullable<typeof installDialog.value>["options"][number]): Promise<void> {
  selectingInstallTarget = true
  try {
    await handleInstallTargetSelected(option)
  } finally {
    selectingInstallTarget = false
    if (!installDialog.value) restoreFocus(installDialogInvoker)
    if (!installDialog.value) installDialogInvoker = null
  }
}

function cancelEdit(): void {
  editing.value = false
  clearReplacement()
}

async function saveEdit(): Promise<void> {
  const pkg = detailPackage.value
  if (!pkg || !editDraft.value.title.trim()) return
  const saved = await handleSavePackageEdit({
    title: editDraft.value.title.trim(),
    summary: editDraft.value.summary.trim(),
    author: editDraft.value.author.trim(),
    version: replacementLabel.value ? editDraft.value.version.trim() : pkg.resourceVersion,
    tags: editDraft.value.tags.trim(),
  })
  if (saved) editing.value = false
}

function chooseReplacement(item: SpatialUploadItem): void {
  handleReplacementSelected(item.selection)
  const defaults = uploadMetadataDefaults(item.selection)
  editDraft.value.version = defaults.version ?? editDraft.value.version
}

function closeInstallDialog(): void {
  dismissInstallDialog()
}

async function showReplacementDialog(): Promise<void> {
  replacementDialogInvoker = activeElement()
  await openControllerReplacementDialog()
  if (!replacementDialogOpen.value) replacementDialogInvoker = null
}

function closeReplacementDialog(): void {
  replacementDialogOpen.value = false
}

function emptyDraft(): UploadDraft {
  return { title: "", summary: "", author: "", version: "", tags: "" }
}

function draftFromMetadata(metadata: MarketUploadMetadata): UploadDraft {
  return {
    title: metadata.title ?? "",
    summary: metadata.summary ?? "",
    author: metadata.author ?? "",
    version: metadata.version ?? "",
    tags: metadata.tags ?? "",
  }
}

function optional(value: string): string | undefined {
  return value.trim() || undefined
}

watch(replacementDefaults, (defaults) => {
  if (defaults?.version) editDraft.value.version = defaults.version
})

watch(installDialog, async (state, previous) => {
  if (state) {
    await nextTick()
    focusFirstDialogControl(installDialogElement.value)
  } else if (previous && !selectingInstallTarget) {
    restoreFocus(installDialogInvoker)
    installDialogInvoker = null
  }
})

watch(replacementDialogOpen, async (isOpen, wasOpen) => {
  if (isOpen) {
    await nextTick()
    focusFirstDialogControl(replacementDialogElement.value)
  } else if (wasOpen) {
    restoreFocus(replacementDialogInvoker)
    replacementDialogInvoker = null
  }
})

function activeElement(): HTMLElement | null {
  return document.activeElement instanceof HTMLElement ? document.activeElement : null
}

function focusFirstDialogControl(dialog: HTMLElement | null): void {
  const target = dialog?.querySelector<HTMLElement>(".spatial-market__target:not(:disabled), button:not(:disabled)")
  const focusTarget = target ?? dialog
  focusTarget?.focus()
}

function restoreFocus(target: HTMLElement | null): void {
  if (target?.isConnected) target.focus()
}
</script>

<style scoped>
.spatial-market {
  position: relative;
  grid-template-rows: auto minmax(0, 1fr);
}

.spatial-market__body {
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-columns: 156px minmax(0, 1fr);
}

.spatial-market__rail {
  display: grid;
  min-height: 0;
  padding: 10px;
  align-content: start;
  gap: 5px;
  overflow: auto;
  border-right: 1px solid var(--spatial-app-border);
  background: var(--spatial-app-surface-muted);
}

.spatial-market__rail button {
  display: grid;
  min-height: 46px;
  padding: 7px;
  align-items: center;
  grid-template-columns: 24px minmax(0, 1fr);
  gap: 7px;
  border: 1px solid transparent;
  color: var(--spatial-app-muted);
  background: transparent;
  text-align: left;
}

.spatial-market__rail :deep(.spatial-action-button__icon) {
  width: 17px;
  height: 17px;
}

.spatial-market__rail button[aria-pressed="true"],
.spatial-market__rail button:hover,
.spatial-market__rail button[data-spatial-hover] {
  border-color: var(--spatial-app-border-strong);
  color: var(--spatial-window-ink);
  background: var(--spatial-app-surface-strong);
}

.spatial-market__rail svg {
  width: 17px;
  height: 17px;
  color: var(--spatial-window-accent);
}

.spatial-market__rail :deep(.spatial-action-button__label) {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.spatial-market__rail strong,
.spatial-market__rail small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.spatial-market__rail strong {
  font-size: 10px;
}

.spatial-market__rail small {
  font-family: "JetBrains Mono", monospace;
  font-size: 8px;
}

.spatial-market__scope {
  margin-top: 8px;
  border-top-color: var(--spatial-app-border) !important;
}

.spatial-market__content {
  padding: 12px;
}

.spatial-market__screen {
  min-width: 0;
}

.spatial-market__sort {
  width: 112px;
}

.spatial-market__filters {
  display: grid;
  margin-bottom: 12px;
  grid-template-columns: minmax(160px, 1fr) minmax(110px, 0.45fr);
  gap: 8px;
}

.spatial-market__compact-type {
  display: none;
}

.spatial-market__compact-type .spatial-select {
  width: 100%;
}

.spatial-market__compact-scope {
  display: none;
}

.spatial-market__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(156px, 1fr));
  gap: 10px;
}

.spatial-market-card {
  display: grid;
  min-width: 0;
  padding: 0 0 10px;
  align-content: start;
  gap: 6px;
  overflow: hidden;
  border: 1px solid var(--spatial-app-border);
  color: var(--spatial-window-ink);
  background: var(--spatial-app-surface-muted);
  text-align: left;
}

.spatial-market-card:hover,
.spatial-market-card[data-spatial-hover] {
  border-color: var(--spatial-window-tab);
  background: var(--spatial-app-surface-strong);
}

.spatial-market-card:focus-visible > strong {
  color: var(--spatial-window-accent);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.spatial-market-card__cover {
  aspect-ratio: 16 / 10;
  min-height: 90px;
  border-bottom: 1px solid var(--spatial-app-border);
}

.spatial-market-card > :not(.spatial-market-card__cover) {
  margin-right: 9px;
  margin-left: 9px;
}

.spatial-market-card strong,
.spatial-market-card p {
  overflow: hidden;
  margin-top: 0;
  margin-bottom: 0;
  text-overflow: ellipsis;
}

.spatial-market-card strong {
  font-size: 12px;
  white-space: nowrap;
}

.spatial-market-card p {
  display: -webkit-box;
  color: var(--spatial-app-muted);
  font-size: 9px;
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.spatial-market__center {
  min-height: 300px;
  place-content: center;
  justify-items: center;
  text-align: center;
}

.spatial-market__center > svg {
  width: 32px;
  height: 32px;
  color: var(--spatial-window-accent);
}

.spatial-market__load-more {
  display: flex;
  padding: 14px;
  justify-content: center;
}

.spatial-market-detail,
.spatial-market-upload,
.spatial-market__form {
  display: grid;
  gap: 12px;
}

.spatial-market-detail__hero {
  display: grid;
  grid-template-columns: minmax(220px, 0.8fr) minmax(260px, 1fr);
  gap: 14px;
}

.spatial-market-detail__cover {
  aspect-ratio: 16 / 10;
  min-height: 180px;
  border: 1px solid var(--spatial-app-border);
}

.spatial-market-detail__summary {
  display: grid;
  align-content: start;
  gap: 9px;
}

.spatial-market-detail__summary h2,
.spatial-market-detail__summary p,
.spatial-market-detail__summary dl {
  margin: 0;
}

.spatial-market-detail__summary h2 {
  font-size: 20px;
}

.spatial-market-detail__summary p {
  color: var(--spatial-app-muted);
  font-size: 11px;
  line-height: 1.65;
}

.spatial-app__tags span {
  padding: 3px 6px;
  border: 1px solid var(--spatial-app-border);
  font-family: "JetBrains Mono", monospace;
  font-size: 8px;
}

.spatial-market-detail__summary dl {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.spatial-market-detail__summary dt,
.spatial-market-detail__summary dd {
  margin: 0;
  font-size: 9px;
}

.spatial-market-detail__summary dt {
  color: var(--spatial-app-muted);
  font-family: "JetBrains Mono", monospace;
}

.spatial-market__section-heading,
.spatial-market__replacement {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.spatial-market__section-heading h2,
.spatial-market__section-heading p {
  margin: 0;
}

.spatial-market__section-heading p {
  margin-top: 4px;
  color: var(--spatial-app-muted);
  font-size: 9px;
}

.spatial-market__field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 9px;
}

.spatial-market__replacement {
  padding: 10px;
  align-items: center;
  flex-wrap: wrap;
  border: 1px solid var(--spatial-app-border);
}

.spatial-market__replacement > span {
  display: grid;
  margin-right: auto;
  gap: 3px;
  font-size: 10px;
}

.spatial-market__replacement small {
  color: var(--spatial-app-muted);
}

.spatial-market__upload-items {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 8px;
}

.spatial-market__upload-items > button,
.spatial-market__target {
  display: grid;
  min-width: 0;
  padding: 9px;
  align-items: center;
  grid-template-columns: 36px minmax(0, 1fr);
  gap: 8px;
  border: 1px solid var(--spatial-app-border);
  color: var(--spatial-window-ink);
  background: var(--spatial-app-surface-muted);
  text-align: left;
}

.spatial-market__upload-items > button[aria-pressed="true"],
.spatial-market__upload-items > button:hover,
.spatial-market__target:hover {
  border-color: var(--spatial-window-tab);
  background: var(--spatial-app-surface-strong);
}

.spatial-market__upload-items .spatial-image {
  width: 36px;
  height: 36px;
}

.spatial-market__upload-items > button > svg {
  width: 22px;
  height: 22px;
  color: var(--spatial-window-accent);
}

.spatial-market__upload-items span,
.spatial-market__target {
  font-size: 9px;
}

.spatial-market__upload-items span {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.spatial-market__upload-items strong,
.spatial-market__upload-items small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.spatial-market__upload-items small,
.spatial-market__target span,
.spatial-market__target small {
  color: var(--spatial-app-muted);
}

.spatial-market__target {
  grid-template-columns: minmax(0, 1fr);
  align-items: start;
}

@container (max-width: 640px) {
  .spatial-market__body {
    grid-template-columns: minmax(0, 1fr);
  }

  .spatial-market__rail {
    display: none;
  }

  .spatial-market__filters {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .spatial-market__compact-type {
    display: grid;
    grid-column: 1 / -1;
  }

  .spatial-market__compact-scope {
    display: inline-grid;
    grid-column: 1 / -1;
    justify-content: center;
  }

  .spatial-market-detail__hero {
    grid-template-columns: minmax(0, 1fr);
  }

  .spatial-app__header {
    align-items: flex-start;
    flex-direction: column;
  }
}

@container (max-width: 430px) {
  .spatial-market__filters,
  .spatial-market__field-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
