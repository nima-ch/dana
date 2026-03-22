import { Elysia } from "elysia"
import { cors } from "@elysiajs/cors"
import { swagger } from "@elysiajs/swagger"
import { topicsRouter } from "./routes/topics"
import { streamRouter } from "./routes/stream"
import { fetchAvailableModels } from "./llm/proxyClient"

const app = new Elysia()
  .use(cors())
  .use(swagger({ path: "/docs" }))
  .use(topicsRouter)
  .use(streamRouter)
  .get("/health", () => ({ status: "ok" }))
  .get("/api/models", async () => {
    return fetchAvailableModels()
  })
  .listen(Number(process.env.PORT) || 3000)

console.log(`Dana backend running at http://localhost:${app.server?.port}`)
