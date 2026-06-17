// 平台 WebUI 路由配置（B4）
// - Hash 模式：原型期没有服务器路由配置，hash 最稳
// - 懒加载：4 个 view 独立 chunk，避免初始 bundle 膨胀
// - 路径用 kebab-case；view 文件命名 PascalCase

import { createRouter, createWebHashHistory } from "vue-router"

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: "/",
      name: "desktop",
      component: () => import("../views/DesktopView.vue"),
    },
    {
      path: "/market",
      name: "app-market",
      component: () => import("../views/AppMarketView.vue"),
    },
    {
      path: "/settings",
      name: "settings",
      component: () => import("../views/SettingsView.vue"),
    },
    {
      path: "/library",
      name: "library",
      component: () => import("../views/GameCardLibraryView.vue"),
    },
    {
      path: "/workspace",
      name: "workspace",
      component: () => import("../views/WorkspaceExplorerView.vue"),
    },
    {
      path: "/workspace/editor",
      name: "workspace-editor",
      component: () => import("../views/WorkspaceEditorView.vue"),
    },
    {
      path: "/studio",
      name: "studio",
      component: () => import("../views/StudioView.vue"),
    },
    {
      path: "/cards/:cardId",
      name: "game-card-detail",
      component: () => import("../views/GameCardDetailView.vue"),
      props: true,
    },
    {
      path: "/play",
      name: "play",
      component: () => import("../views/PlayView.vue"),
    },
    {
      path: "/debug",
      name: "debug",
      component: () => import("../views/DebugView.vue"),
    },
  ],
})

export default router
