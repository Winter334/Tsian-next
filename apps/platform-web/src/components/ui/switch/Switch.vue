<script setup lang="ts">
import type { SwitchRootEmits, SwitchRootProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import {
  SwitchRoot,
  SwitchThumb,
  useForwardPropsEmits,
} from "reka-ui"
import { cn } from "@/lib/utils"

const props = defineProps<SwitchRootProps & { class?: HTMLAttributes["class"] }>()

const emits = defineEmits<SwitchRootEmits>()

const delegatedProps = reactiveOmit(props, "class")

const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <!--
    RetroOS toggle. The track is a sunken surface (retro-inset) in the OFF
    state and fills with the neon phosphor color when ON; the thumb slides
    and flips from dim to neon so the state reads at a glance. Sharp corners
    and hairline borders match the brutalist desktop chrome.
  -->
  <SwitchRoot
    v-bind="forwarded"
    :class="cn(
      'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center border border-neon-deep/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon focus-visible:ring-offset-2 focus-visible:ring-offset-void disabled:cursor-not-allowed disabled:opacity-40',
      // OFF: sunken dark track (retro-inset look)
      'data-[state=unchecked]:bg-[#1e2420] data-[state=unchecked]:shadow-[inset_1px_1px_0_rgba(0,0,0,0.75),inset_-1px_-1px_0_rgba(246,236,215,0.08)]',
      // ON: neon phosphor fill with a soft glow
      'data-[state=checked]:border-neon data-[state=checked]:bg-neon data-[state=checked]:shadow-[0_0_8px_rgba(243,197,109,0.26),inset_0_0_4px_rgba(243,197,109,0.12)]',
      props.class,
    )"
  >
    <SwitchThumb
      :class="cn(
        'pointer-events-none block h-3.5 w-3.5 border transition-transform',
        // OFF thumb: dim, sits left
        'data-[state=unchecked]:translate-x-0.5 data-[state=unchecked]:border-neon-muted/70 data-[state=unchecked]:bg-neon-muted/40',
        // ON thumb: dark inset on the lit track (high contrast), slides right
        'data-[state=checked]:translate-x-[18px] data-[state=checked]:border-[#2c2418] data-[state=checked]:bg-[#2c2418]',
      )"
    >
      <slot name="thumb" />
    </SwitchThumb>
  </SwitchRoot>
</template>
