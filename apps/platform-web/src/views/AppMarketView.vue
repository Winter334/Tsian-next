<template>
  <section class="market-view grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
    <div class="market-toolbar retro-toolbar border-b px-3 py-2">
      <div class="market-toolbar-primary flex min-w-0 flex-wrap items-center gap-2">
        <button
          v-if="screen.kind !== 'list'"
          type="button"
          class="retro-focus grid h-7 w-7 place-items-center border border-neon-deep/40 bg-elevated text-text-dim transition-colors hover:border-neon/55 hover:text-neon"
          title="返回"
          @click="goBack"
        >
          <ArrowLeft class="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
          @click="openUploadScreen"
        >
          <Upload class="h-3.5 w-3.5" aria-hidden="true" />
          上传资源
        </button>
        <select
          v-model="sortMode"
          class="retro-focus retro-select-surface min-w-[100px] border border-neon-deep/45 bg-elevated px-2 py-1 font-mono text-xs text-text-main"
          @change="refresh"
        >
          <option value="newest">最新</option>
          <option value="downloads">下载量</option>
        </select>
      </div>
      <div class="market-toolbar-filters flex min-w-0 flex-wrap items-center gap-2">
        <MarketTagFilter class="market-tag-filter" v-model="tagQuery" @update:model-value="onTagInput" />
        <label class="market-search relative min-w-[220px]">
          <Search class="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neon-muted" aria-hidden="true" />
          <span class="sr-only">搜索创意工坊</span>
          <input
            v-model="searchQuery"
            type="search"
            placeholder="搜索创意工坊"
            class="retro-focus retro-select-surface h-7 w-full border border-neon-deep/55 bg-elevated pl-7 pr-2 font-mono text-xs text-text-main placeholder:text-text-dim/60"
            @input="onSearchInput"
          />
        </label>
      </div>
    </div>

    <main class="market-content m-3 grid min-h-0 gap-3 overflow-auto">
      <MarketResourceTypeSidebar
        class="market-resource-sidebar"
        v-model="currentType"
        :options="resourceTypeOptions"
        :counts="resourceCounts"
        :scope="marketScope"
        @update:model-value="switchType"
        @toggle-scope="toggleMarketScope"
      />

      <div v-if="screen.kind === 'list'" class="market-compact-filters min-w-0 gap-2">
        <label class="min-w-0 flex-1">
          <span class="sr-only">资源类型</span>
          <select
            :value="currentType"
            class="retro-focus retro-select-surface h-8 w-full min-w-0 border border-neon-deep/45 bg-elevated px-2 font-mono text-xs text-text-main"
            @change="switchType(($event.target as HTMLSelectElement).value as MarketResourceType)"
          >
            <option v-for="option in resourceTypeOptions" :key="option.type" :value="option.type">
              {{ option.label }} · {{ resourceCounts[option.type] ?? 0 }}
            </option>
          </select>
        </label>
        <button
          type="button"
          class="retro-button retro-focus inline-flex h-8 shrink-0 items-center px-3 font-mono text-xs"
          @click="toggleMarketScope"
        >
          {{ marketScope === "mine" ? "全部资源" : "我的上传" }}
        </button>
      </div>

      <section class="market-result-pane retro-inset min-h-0 overflow-auto p-3">
        <div v-if="screen.kind === 'list'" class="grid gap-3">
          <div v-if="marketScope === 'mine' && !loggedIn" class="grid place-items-center py-12">
            <UserRound class="h-10 w-10 text-neon-muted" aria-hidden="true" />
            <p class="mt-3 text-sm text-text-dim">登录后管理你发布到创意工坊的资源。</p>
            <button
              type="button"
              class="retro-button retro-focus mt-4 inline-flex h-9 items-center gap-2 px-4 font-mono text-xs"
              @click="openAccountCenter"
            >
              <UserRound class="h-3.5 w-3.5" aria-hidden="true" />
              打开账号中心
            </button>
          </div>
          <div v-else-if="loading" class="grid place-items-center py-12">
            <p class="font-mono text-xs text-text-dim">加载中…</p>
          </div>
          <div v-else-if="packages.length === 0" class="grid place-items-center py-12">
            <Store class="h-10 w-10 text-neon-muted" aria-hidden="true" />
            <p class="mt-3 text-sm text-text-dim">{{ emptyMessage }}</p>
          </div>
          <MarketPackageGrid v-else :packages="packages" @open="openDetail" />
          <div v-if="packages.length > 0" class="flex justify-center py-2">
            <button
              v-if="nextCursor"
              type="button"
              class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-4 font-mono text-xs"
              :disabled="loadingMore"
              @click="loadMore"
            >
              {{ loadingMore ? "加载中…" : "加载更多" }}
            </button>
            <span v-else class="font-mono text-[11px] text-text-dim">已全部加载</span>
          </div>
        </div>

        <div v-else-if="screen.kind === 'detail'" class="grid gap-4">
          <div v-if="detailLoading" class="grid place-items-center py-12">
            <p class="font-mono text-xs text-text-dim">加载中…</p>
          </div>
          <div v-else-if="!detailPackage" class="grid place-items-center py-12">
            <p class="text-sm text-text-dim">资源不存在或已被删除。</p>
          </div>
          <MarketPackageDetail
            v-else
            :pkg="detailPackage"
            :installing="installing"
            :can-manage="canManageDetail"
            :updating="updatingPackage"
            :deleting="deletingPackage"
            :replacement-label="replacementLabel"
            :replacement-defaults="replacementDefaults"
            :save-token="editSaveToken"
            @install="handleDownloadInstall"
            @start-edit="startEditPackage"
            @cancel-edit="clearReplacement"
            @select-replacement="openReplacementDialog"
            @clear-replacement="clearReplacement"
            @save-edit="handleSavePackageEdit"
            @delete="handleDeletePackage"
          />
        </div>

        <div v-else-if="screen.kind === 'upload'" class="grid gap-4">
          <div v-if="!loggedIn" class="grid place-items-center py-12">
            <UserRound class="h-10 w-10 text-neon-muted" aria-hidden="true" />
            <p class="mt-3 text-sm text-text-dim">上传资源需要先登录。</p>
            <button
              type="button"
              class="retro-button retro-focus mt-4 inline-flex h-9 items-center gap-2 px-4 font-mono text-xs"
              @click="openAccountCenter"
            >
              <UserRound class="h-3.5 w-3.5" aria-hidden="true" />
              打开账号中心
            </button>
          </div>
          <MarketUploadPanel
            v-else
            :resource-types="resourceTypeOptions"
            :initial-type="currentType"
            :cards="uploadCards"
            :agent-options="agentUploadOptions"
            :skill-options="skillUploadOptions"
            :tool-options="toolUploadOptions"
            :loading="localResourcesLoading"
            :uploading="uploading"
            @prepare-upload="handlePrepareUpload"
          />
        </div>

        <p v-if="feedback" class="mt-4 border border-neon-deep/40 bg-neon/10 px-3 py-2 text-sm text-neon">
          {{ feedback }}
        </p>
        <p v-if="errorMessage" class="mt-4 border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {{ errorMessage }}
        </p>
      </section>
    </main>

    <MarketInstallDialog
      v-if="installDialog"
      :state="installDialog"
      @close="closeInstallDialog"
      @select="handleInstallTargetSelected"
    />
    <MarketReplacementDialog
      v-if="replacementDialogOpen && detailPackage"
      :pkg="detailPackage"
      :cards="uploadCards"
      :agent-options="agentUploadOptions"
      :skill-options="skillUploadOptions"
      :tool-options="toolUploadOptions"
      :loading="localResourcesLoading"
      @close="replacementDialogOpen = false"
      @select="handleReplacementSelected"
    />
  </section>
</template>

<script setup lang="ts">
import type { MarketResourceType } from "@tsian/contracts"
import { ArrowLeft, Search, Store, Upload, UserRound } from "lucide-vue-next"
import MarketInstallDialog from "@/components/market/MarketInstallDialog.vue"
import MarketPackageDetail from "@/components/market/MarketPackageDetail.vue"
import MarketPackageGrid from "@/components/market/MarketPackageGrid.vue"
import MarketReplacementDialog from "@/components/market/MarketReplacementDialog.vue"
import MarketResourceTypeSidebar from "@/components/market/MarketResourceTypeSidebar.vue"
import MarketTagFilter from "@/components/market/MarketTagFilter.vue"
import MarketUploadPanel from "@/components/market/MarketUploadPanel.vue"
import { useAppMarketController } from "@/controllers/market/use-app-market-controller"

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
  editSaveToken,
  canManageDetail,
  openUploadScreen,
  handlePrepareUpload,
  handleDownloadInstall,
  handleInstallTargetSelected,
  closeInstallDialog,
  startEditPackage,
  clearReplacement,
  openReplacementDialog,
  handleReplacementSelected,
  handleSavePackageEdit,
  handleDeletePackage,
  openAccountCenter,
} = useAppMarketController()
</script>

<style scoped>
.market-view {
  container-type: inline-size;
}

.market-toolbar {
  display: grid;
  min-width: 0;
  gap: 0.5rem;
}

.market-toolbar-primary {
  justify-content: space-between;
}

.market-toolbar-filters {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
}

.market-tag-filter,
.market-search {
  min-width: 0;
  width: 100%;
}

.market-content {
  grid-template-columns: minmax(0, 1fr);
}

.market-resource-sidebar {
  display: none;
}

.market-compact-filters {
  display: flex;
}

@container (min-width: 760px) {
  .market-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .market-toolbar-primary {
    justify-content: flex-start;
  }

  .market-toolbar-filters {
    display: flex;
  }

  .market-tag-filter {
    min-width: 160px;
    width: auto;
  }

  .market-search {
    min-width: 220px;
    width: auto;
  }

  .market-content {
    grid-template-columns: 220px minmax(0, 1fr);
  }

  .market-resource-sidebar {
    display: grid;
  }

  .market-compact-filters {
    display: none;
  }
}
</style>
