import { Elysia } from "elysia"
import { cors } from "@elysiajs/cors"
import { swagger } from "@elysiajs/swagger"
import { topicsRouter } from "./routes/topics"

const app = new Elysia()
  .use(cors())
  .use(swagger({ path: "/docs" }))
  .use(topicsRouter)
  .get("/health", () => ({ status: "ok" }))
  .listen(Number(process.env.PORT) || 3000)

console.log(`Dana backend running at http://localhost:${app.server?.port}`)
