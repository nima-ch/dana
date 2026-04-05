import { Elysia } from "elysia"
import { getForumSession } from "../tools/internal/getForumData"
import { dbGetRepresentatives } from "../db/queries/forum"
import { getDb } from "../db/database"

export const forumRouter = new Elysia({ prefix: "/api/topics/:id" })
  .get("/forum/:sessionId", async ({ params, error }) => {
    try {
      return await getForumSession(params.id, params.sessionId)
    } catch {
      return error(404, { message: "Forum session not found" })
    }
  })
  .get("/forum", async ({ params }) => {
    const row = getDb().query<{ id: string }, [string]>(
      "SELECT id FROM forum_sessions WHERE topic_id = ? ORDER BY started_at DESC LIMIT 1"
    ).get(params.id)
    if (!row) return null
    try {
      return await getForumSession(params.id, row.id)
    } catch {
      return null
    }
  })
  .get("/representatives", async ({ params }) => {
    return dbGetRepresentatives(params.id)
  })
