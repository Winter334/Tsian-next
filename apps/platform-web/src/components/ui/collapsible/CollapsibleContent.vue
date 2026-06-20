<script setup lang="ts">
import type { CollapsibleContentProps } from "reka-ui"
import { CollapsibleContent, useForwardProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"

const props = defineProps<CollapsibleContentProps & { class?: HTMLAttributes["class"] }>()

const forwarded = useForwardProps(props)
</script>

<template>
  <CollapsibleContent v-bind="forwarded" :class="cn(props.class)">
    <slot />
  </CollapsibleContent>
</template>
