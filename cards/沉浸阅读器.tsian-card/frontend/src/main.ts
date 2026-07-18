import { createApp } from "vue"
import App from "./App.vue"
import "./lib/tokens.css"

// Tsian 游戏前端入口。
// Vue 3 SFC 应用，挂载到 #app。
// 协议层走 @tsian/play-bridge。
// 视觉方向：烛火书卷·重铸（A+ 暗色仪式系）。
createApp(App).mount("#app")
