<script setup lang="ts">
withDefaults(
  defineProps<{
    /** 括号尺寸 px */
    size?: number
    /** 距离边缘 px */
    inset?: number
  }>(),
  { size: 15, inset: 25 },
)
</script>

<template>
  <div class="corner-brackets" aria-hidden="true">
    <span
      v-for="pos in ['top-left', 'top-right', 'bottom-left', 'bottom-right']"
      :key="pos"
      :class="['bracket', pos]"
      :style="{
        width: size + 'px',
        height: size + 'px',
        borderWidth: '2px',
        borderColor: 'rgba(181, 137, 61, 0.15)',
      }"
    />
  </div>
</template>

<style scoped>
.corner-brackets {
  position: fixed;
  inset: 0;
  z-index: 1;
  pointer-events: none;
}

.bracket {
  position: absolute;
  border-style: solid;
}

.top-left {
  top: v-bind("inset + 'px'");
  left: v-bind("inset + 'px'");
  border-right: none;
  border-bottom: none;
}
.top-right {
  top: v-bind("inset + 'px'");
  right: v-bind("inset + 'px'");
  border-left: none;
  border-bottom: none;
}
.bottom-left {
  bottom: v-bind("inset + 'px'");
  left: v-bind("inset + 'px'");
  border-right: none;
  border-top: none;
}
.bottom-right {
  bottom: v-bind("inset + 'px'");
  right: v-bind("inset + 'px'");
  border-left: none;
  border-top: none;
}
</style>
