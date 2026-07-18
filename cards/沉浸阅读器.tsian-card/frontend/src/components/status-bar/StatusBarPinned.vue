<script setup lang="ts">
/**
 * StatusBarPinned — 左侧状态栏"钉选"字段区。
 *
 * design §9 / §10 / §11 / §12：
 * - Props：`protagonistRef: string | null`。
 * - 通过 `useEntity(protagonistRef)` 在 setup 阶段 `.load()` 读主角实体。
 *   主角切换由 `StatusBar.vue` 侧 `:key=protagonistRefStr` 触发本组件 remount。
 * - 通过 `useStatusBarPins()` 拿钉选清单。
 * - `pinValues = pins.map(t => readPinValue(entity, t))`。
 * - 分区整体 `v-if="pins.length > 0"`（R7：无钉选不占位）。
 * - 六类字段渲染分支 + missing 分支。
 * - 复用现有 `.sb-section-head / .sb-section-title / .sb-section-line` 视觉（与 Status/Metrics 一致）。
 *
 * 错误策略（design §12）：
 * - entity 加载失败/未找到 → 所有钉选走 missing 分支；分区仍展示。
 * - 单个字段缺失 → 单条走 missing；其他字段正常渲染。
 * - 主角为 null → pins 仍可能非空（历史钉选），全部走 missing。
 */
import { computed, onMounted } from "vue"
import { useEntity } from "../../composables/useEntity"
import { useStatusBarPins } from "../../composables/useStatusBarPins"
import { parseCharacter } from "../../lib/parse-character"
import { readPinValue } from "../../lib/pin-types"
import type { PinValue } from "../../lib/pin-types"

const props = defineProps<{
  /** 主角 entity ref（`character:<localId>`）；null 时不加载。 */
  protagonistRef: string | null
}>()

const { pins } = useStatusBarPins()

// useEntity 在 setup 期捕获 ref 字符串；父容器通过 :key=protagonistRef 变化重挂本组件。
// ref 为空时不发起读取；entityData 保持 null，所有钉选走 missing。
const { data: entityData, load: loadEntity } = useEntity(props.protagonistRef ?? "")

onMounted(() => {
  if (props.protagonistRef) void loadEntity()
})

const pinValues = computed<PinValue[]>(() => {
  // entityData.entity 是原始 Record，需通过 parseCharacter 归一到 CharacterEntity；
  // 归一失败（缺 id/name/brief 等必需字段）时降级为 null，所有钉选走 missing。
  const raw = entityData.value?.entity
  const entity = raw !== undefined ? parseCharacter(raw) : null
  return pins.value.map((t) => readPinValue(entity, t))
})

/**
 * 计算 gauge 进度条填充百分比（0-100）。max 缺省或 <=0 时不显示进度条（返回 null）。
 */
function gaugePercent(value: number, max: number | undefined): number | null {
  if (typeof max !== "number" || !Number.isFinite(max) || max <= 0) return null
  const p = (value / max) * 100
  if (p < 0) return 0
  if (p > 100) return 100
  return p
}

/**
 * 生成每项稳定的 v-for key：kind + key（appearance 无 key，用固定字面量）。
 * 与 pins 数组顺序一致；用于避免同 kind 多项 DOM 复用错乱。
 */
function itemKey(v: PinValue, idx: number): string {
  if (v.kind === "missing") {
    const t = v.target
    return `missing:${t.kind}:${t.key ?? "-"}:${idx}`
  }
  if (v.kind === "appearance") return `appearance:${idx}`
  if (v.kind === "attribute" || v.kind === "identity" || v.kind === "goals") {
    return `${v.kind}:${v.label}:${idx}`
  }
  // status / gauge：用 name（缺省时 pin.label 已归一进 name）。
  return `${v.kind}:${v.name}:${idx}`
}
</script>

<template>
  <section v-if="pins.length > 0" class="sb-pinned">
    <header class="sb-section-head">
      <h3 class="sb-section-title">钉选</h3>
      <span class="sb-section-line" />
    </header>

    <ul class="pin-list">
      <li v-for="(v, idx) in pinValues" :key="itemKey(v, idx)" class="pin-item">
        <!-- status -->
        <div v-if="v.kind === 'status'" class="pin-status-chip" :title="v.description">
          <span class="pin-status-name">{{ v.name }}</span>
          <span
            v-if="v.polarity"
            class="pin-status-polarity"
            :class="`polarity-${v.polarity}`"
          >{{ v.polarity }}</span>
        </div>

        <!-- attribute -->
        <div v-else-if="v.kind === 'attribute'" class="pin-attribute-row">
          <span class="pin-attr-label">{{ v.label }}</span>
          <span class="pin-attr-value">{{ v.value }}</span>
        </div>

        <!-- gauge -->
        <div v-else-if="v.kind === 'gauge'" class="pin-gauge-row">
          <div class="pin-gauge-head">
            <span class="pin-gauge-label">{{ v.name }}</span>
            <span class="pin-gauge-value">
              {{ v.value }}<template v-if="typeof v.max === 'number'">/{{ v.max }}</template
              ><span v-if="v.unit" class="pin-gauge-unit">{{ v.unit }}</span>
            </span>
          </div>
          <div
            v-if="gaugePercent(v.value, v.max) !== null"
            class="pin-gauge-track"
            :class="v.tone ? `tone-${v.tone}` : undefined"
          >
            <div class="pin-gauge-fill" :style="{ width: `${gaugePercent(v.value, v.max)}%` }" />
          </div>
        </div>

        <!-- identity -->
        <div v-else-if="v.kind === 'identity'" class="pin-chip">
          <span class="pin-chip-label">{{ v.label }}</span>
          <span class="pin-chip-sep">：</span>
          <span class="pin-chip-value">{{ v.value }}</span>
        </div>

        <!-- appearance -->
        <div v-else-if="v.kind === 'appearance'" class="pin-appearance" :title="v.text">
          {{ v.text }}
        </div>

        <!-- goals -->
        <div v-else-if="v.kind === 'goals'" class="pin-chip">
          <span class="pin-chip-label">{{ v.label }}</span>
          <span class="pin-chip-sep">：</span>
          <span class="pin-chip-value">{{ v.value }}</span>
        </div>

        <!-- missing -->
        <div v-else class="pin-missing">
          <span class="pin-missing-label">{{ v.label }}</span>
          <span class="pin-missing-sep">—</span>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.sb-pinned {
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 复用 Status/Metrics/Refs 的分区标题样式（design §9） */
.sb-section-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sb-section-title {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.65rem;
  letter-spacing: 0.08em;
  color: var(--prose-faint);
  text-transform: uppercase;
  flex-shrink: 0;
}
.sb-section-line {
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, var(--line-strong), transparent);
  opacity: 0.6;
}

.pin-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.pin-item {
  min-width: 0;
}

/* status chip */
.pin-status-chip {
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex-wrap: wrap;
}
.pin-status-name {
  font-family: var(--font-serif);
  font-size: 0.82rem;
  color: var(--prose);
  line-height: 1.4;
}
.pin-status-polarity {
  font-family: var(--font-mono);
  font-size: 0.65rem;
  color: var(--prose-muted);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 0 6px;
  letter-spacing: 0.05em;
  flex-shrink: 0;
  text-transform: lowercase;
}
.pin-status-polarity.polarity-positive {
  color: #7ea968;
  border-color: rgba(126, 169, 104, 0.4);
}
.pin-status-polarity.polarity-negative {
  color: #c76d5a;
  border-color: rgba(199, 109, 90, 0.4);
}
.pin-status-polarity.polarity-neutral {
  color: var(--prose-muted);
}

/* attribute row */
.pin-attribute-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.pin-attr-label {
  font-family: var(--font-serif);
  font-size: 0.8rem;
  color: var(--prose-muted);
}
.pin-attr-value {
  font-family: var(--font-mono);
  font-size: 0.85rem;
  color: var(--ember-bright);
}

/* gauge row */
.pin-gauge-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.pin-gauge-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.pin-gauge-label {
  font-family: var(--font-serif);
  font-size: 0.78rem;
  color: var(--prose-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pin-gauge-value {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--ember-bright);
  flex-shrink: 0;
}
.pin-gauge-unit {
  margin-left: 2px;
  font-size: 0.65rem;
  color: var(--prose-muted);
}
.pin-gauge-track {
  height: 3px;
  border-radius: 2px;
  background: rgba(181, 137, 61, 0.1);
  overflow: hidden;
}
.pin-gauge-fill {
  height: 100%;
  border-radius: 2px;
  background: var(--ember);
  transition: width 0.4s ease;
}
.pin-gauge-track.tone-success .pin-gauge-fill {
  background: #7ea968;
}
.pin-gauge-track.tone-warning .pin-gauge-fill {
  background: #d4a04a;
}
.pin-gauge-track.tone-danger .pin-gauge-fill {
  background: var(--blood);
}
.pin-gauge-track.tone-muted .pin-gauge-fill {
  background: var(--prose-dim);
}
.pin-gauge-track.tone-accent .pin-gauge-fill {
  background: var(--ember-bright);
}
.pin-gauge-track.tone-neutral .pin-gauge-fill {
  background: var(--ember);
}

/* identity / goals chip */
.pin-chip {
  display: flex;
  align-items: baseline;
  gap: 2px;
  font-size: 0.8rem;
  line-height: 1.5;
  flex-wrap: wrap;
}
.pin-chip-label {
  font-family: var(--font-mono);
  font-size: 0.65rem;
  letter-spacing: 0.06em;
  color: var(--prose-faint);
  flex-shrink: 0;
}
.pin-chip-sep {
  color: var(--prose-faint);
  font-size: 0.7rem;
}
.pin-chip-value {
  font-family: var(--font-serif);
  color: var(--prose);
  min-width: 0;
  overflow-wrap: anywhere;
}

/* appearance: 1 行 ellipsis + tooltip 全文 */
.pin-appearance {
  font-family: var(--font-serif);
  font-size: 0.8rem;
  line-height: 1.5;
  color: var(--prose-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* missing */
.pin-missing {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-family: var(--font-serif);
  font-size: 0.78rem;
  color: var(--prose-faint);
  font-style: italic;
}
.pin-missing-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pin-missing-sep {
  color: var(--prose-faint);
  flex-shrink: 0;
}
</style>
