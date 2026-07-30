import { createApp } from "vue"
import App from "./App.vue"
import router from "./router"
import "./style.css"
import { installFrontendDiagnostics } from "./frontend-diagnostics"
import { initializeDiagnosticRecords } from "./storage/diagnostic-records"
import { reportDiagnosticStoreFailure } from "./runtime-host/ai/trace-recorder"

const app = createApp(App)
installFrontendDiagnostics(app)
void initializeDiagnosticRecords().catch(reportDiagnosticStoreFailure)
app.use(router).mount("#app")
