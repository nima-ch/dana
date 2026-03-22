import { Elysia } from "elysia"
import { cors } from "@elysiajs/cors"
import { swagger } from "@elysiajs/swagger"
import { topicsRouter } from "./routes/topics"
import { streamRouter } from "./routes/stream"
import { cluesRouter } from "./routes/clues"
import { partiesRouter } from "./routes/parties"
import { forumRouter } from "./routes/forum"
import { pipelineRouter } from "./routes/pipeline"
import { expertCouncilRouter } from "./routes/expertCouncil"
import { settingsRouter } from "./routes/settings"
import { fetchAvailableModels } from "./llm/proxyClient"

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
  .get("/health", () => ({ status: "ok" }))
  .get("/api/models", async () => {
    return fetchAvailableModels()
  })
  .listen(Number(process.env.PORT) || 3000)

console.log(`Dana backend running at http://localhost:${app.server?.port}`)
