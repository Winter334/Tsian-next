<script setup lang="ts">
import type { CollapsibleTriggerProps } from "reka-ui"
import { CollapsibleTrigger, useForwardProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"

const props = defineProps<CollapsibleTriggerProps & { class?: HTMLAttributes["class"] }>()

const forwarded = useForwardProps(props)
</script>

<template>
  <CollapsibleTrigger v-bind="forwarded" :class="cn(props.class)">
    <slot />
  </CollapsibleTrigger>
</template>
