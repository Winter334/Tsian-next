<script setup lang="ts">
/**
 * InventoryPane — 背包标签页占位（角色卡右侧详情区）。
 *
 * design §4.6 / R10：
 * - 占位：icon + "背包 / 容器详情由后续任务填充"。
 * - 不实现任何物品列表。
 * - 由 `07-04-containers-inventory-item-details` 子任务填充。
 */
</script>

<template>
  <div class="inventory-placeholder">
    <div class="icon">🎒</div>
    <div class="text">背包 / 容器详情由后续任务填充</div>
  </div>
</template>

<style scoped>
.inventory-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 12px;
  color: var(--whisper);
}
.inventory-placeholder .icon {
  font-size: 3rem;
  opacity: 0.3;
}
.inventory-placeholder .text {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  letter-spacing: 0.14em;
}
</style>
