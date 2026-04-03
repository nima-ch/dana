import { Elysia } from "elysia"
import { cors } from "@elysiajs/cors"
import { swagger } from "@elysiajs/swagger"
import { initDb } from "./db/database"
import { topicsRouter } from "./routes/topics"
import { streamRouter } from "./routes/stream"
import { cluesRouter } from "./routes/clues"
import { partiesRouter } from "./routes/parties"
import { forumRouter } from "./routes/forum"
import { pipelineRouter } from "./routes/pipeline"
import { expertCouncilRouter } from "./routes/expertCouncil"
import { settingsRouter } from "./routes/settings"
import { promptsRouter } from "./routes/prompts"
import { providersRouter } from "./routes/providers"
import { agentToolsRouter } from "./routes/agentTools"
import { fetchAvailableModels } from "./llm/proxyClient"

initDb()

const app = new Elysia()
  .use(cors())
  .use(swagger({ path: "/docs" }))
  .use(topicsRouter)
  .use(streamRouter)
  .use(cluesRouter)
  .use(partiesRouter)
  .use(forumRouter)
  .use(pipelineRouter)
  .use(expertCouncilRouter)
  .use(settingsRouter)
  .use(promptsRouter)
  .use(providersRouter)
  .use(agentToolsRouter)
  .get("/health", () => ({ status: "ok" }))
  .get("/api/models", async () => {
    return fetchAvailableModels()
  })
  .listen(Number(process.env.PORT) || 3000)

console.log(`\x1b[1m\x1b[36mDana\x1b[0m backend running at \x1b[36mhttp://localhost:${app.server?.port}\x1b[0m`)
console.log(`  Data:  ${process.env.DATA_DIR || "/home/nima/dana/data"}`)
console.log(`  Proxy: ${process.env.PROXY_BASE_URL || "http://127.0.0.1:8317"}`)
