// 平台 WebUI 路由配置（B4）
// - Hash 模式：原型期没有服务器路由配置，hash 最稳
// - 懒加载：5 个 view 独立 chunk，避免初始 bundle 膨胀
// - 路径用 kebab-case；view 文件命名 PascalCase

import { createRouter, createWebHashHistory } from "vue-router"

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: "/",
      name: "lobby",
      component: () => import("../views/LobbyView.vue"),
    },
    {
      path: "/mod",
      name: "mod",
      component: () => import("../views/ModView.vue"),
    },
    {
      path: "/settings",
      name: "settings",
      component: () => import("../views/SettingsView.vue"),
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
