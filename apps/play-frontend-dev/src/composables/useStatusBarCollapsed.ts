/**
 * composables/useStatusBarCollapsed.ts — 左侧状态栏折叠偏好持久化（模块级单例）。
 *
 * 同 useTsian / useRuntime 模式：模块级共享 ref，watch 写入 localStorage。
 * 不写入 workspace——状态栏折叠是纯前端 UI 偏好（同 AppNav 的 tsian.navCollapsed）。
 *
 * design §4.4：localStorage key `tsian.statusCollapsed`，默认展开（false）。
 */
import { readonly, ref, watch } from "vue"

const KEY = "tsian.statusCollapsed"

// 模块级共享状态：所有 useStatusBarCollapsed() 调用共用同一 ref。
// 仅当 localStorage 显式记录 "true" 时才折叠；缺省/未记录视为展开。
const statusCollapsed = ref<boolean>(localStorage.getItem(KEY) === "true")

// 模块级 watch：折叠态变化即写入 localStorage（不写入 workspace）。
watch(statusCollapsed, (v) => {
  localStorage.setItem(KEY, String(v))
})

/**
 * useStatusBarCollapsed — 状态栏折叠态单例访问。
 *
 * @returns { statusCollapsed, toggle }
 *   - statusCollapsed：只读 ref<boolean>，true 表示折叠为 48px。
 *   - toggle：翻转折叠/展开。
 */
export function useStatusBarCollapsed() {
  function toggle(): void {
    statusCollapsed.value = !statusCollapsed.value
  }

  return {
    /** 折叠态只读视图（true = 折叠 48px，false = 展开 240px）。 */
    statusCollapsed: readonly(statusCollapsed),
    /** 翻转折叠/展开。 */
    toggle,
  }
}
