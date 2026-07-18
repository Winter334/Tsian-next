/**
 * lib/character-avatar.ts — 默认头像按性别选择纯函数。
 *
 * task 07-05 design D2 / D5 / R5：
 * - 默认男/女头像是 play frontend 内置 UI 资产，打包进前端，不进入 workspace。
 * - 选择输入：`entity.identity?.gender ?? entity.gender`。
 * - 规则：
 *   1. 值包含 `女` 或匹配英文 female/woman/girl/f → 女图。
 *   2. 值包含 `男` 或匹配英文 male/man/boy/m → 男图。
 *   3. 缺失/未知/不明确/其它值 → 男图兜底。
 * - 英文先判 female 再判 male，避免 `female` 被 `male` 子串误判。
 *
 * Vite 通过 `vite/client` 支持 PNG import，构建时输出 hashed asset URL。
 */
import defaultFemaleUrl from "../assets/avatars/default-female.png"
import defaultMaleUrl from "../assets/avatars/default-male.png"

/**
 * 按性别字符串选择默认头像 URL。
 *
 * @param gender 性别字符串（可为 undefined）；中文含"女"/"男"或英文 female/male 等匹配。
 * @returns 默认头像 asset URL（女图或男图）。
 */
export function defaultAvatarUrlForGender(gender?: string): string {
  if (!gender) return defaultMaleUrl
  const g = gender.trim().toLowerCase()
  if (!g) return defaultMaleUrl
  // 先判 female 再判 male，避免 `female` 被 `male` 子串误判。
  if (g.includes("女") || g === "female" || g === "woman" || g === "girl" || g === "f") {
    return defaultFemaleUrl
  }
  if (g.includes("男") || g === "male" || g === "man" || g === "boy" || g === "m") {
    return defaultMaleUrl
  }
  // 未知/不明确/其它值 → 男图兜底。
  return defaultMaleUrl
}

/**
 * 从角色 entity 选择默认头像 URL。
 *
 * 优先 `identity.gender`，兼容顶层 `gender`（task 07-05 design D5 / R5）。
 *
 * @param entity 角色实体（含可选 identity.gender 与顶层 gender）。
 * @returns 默认头像 asset URL。
 */
export function pickDefaultAvatarUrl(entity: {
  identity?: { gender?: string }
  gender?: string
}): string {
  return defaultAvatarUrlForGender(entity.identity?.gender ?? entity.gender)
}
