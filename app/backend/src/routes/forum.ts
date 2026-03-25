import { Elysia } from "elysia"
import { getForumSession } from "../tools/internal/getForumData"
import { getAllVersions } from "../pipeline/stateManager"
import { dbGetRepresentatives } from "../db/queries/forum"

export const forumRouter = new Elysia({ prefix: "/api/topics/:id" })
  .get("/forum/:sessionId", async ({ params, error }) => {
    try {
      return await getForumSession(params.id, params.sessionId)
    } catch {
      return error(404, { message: "Forum session not found" })
    }
  })
  .get("/forum", async ({ params }) => {
    const states = await getAllVersions(params.id)
    const latest = states.findLast(s => s.forum_session_id)
    if (!latest?.forum_session_id) return null
    try {
      return await getForumSession(params.id, latest.forum_session_id)
    } catch {
      return null
    }
  })
  .get("/representatives", async ({ params }) => {
    return dbGetRepresentatives(params.id)
  })
