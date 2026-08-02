import { computed, reactive } from "vue"
import { SpatialWindowSession } from "./window-session"

export function useSpatialWindowSession() {
  const session = reactive(new SpatialWindowSession())
  const activeWindow = computed(() => session.activeWindow)
  return { session, activeWindow }
}
