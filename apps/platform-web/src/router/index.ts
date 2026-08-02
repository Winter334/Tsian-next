// 平台 WebUI 路由配置（B4）
// - Hash 模式：原型期没有服务器路由配置，hash 最稳
// - 懒加载：4 个 view 独立 chunk，避免初始 bundle 膨胀
// - 路径用 kebab-case；view 文件命名 PascalCase

import { createRouter, createWebHashHistory } from "vue-router"
import { platformAppRegistry } from "../platform-apps"

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: "/",
      name: "desktop",
      component: () => import("../views/DesktopView.vue"),
    },
    ...platformAppRegistry.map((app) => ({
      path: app.route.path,
      name: app.route.name,
      component: app.retro.component,
      props: app.route.props,
    })),
  ],
})

export default router
