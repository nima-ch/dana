import { Elysia } from "elysia"
import { getForumSession } from "../tools/internal/getForumData"
import { getAllVersions } from "../pipeline/stateManager"

export const forumRouter = new Elysia({ prefix: "/api/topics/:topicId" })
  .get("/forum/:sessionId", async ({ params, error }) => {
    try {
      return await getForumSession(params.topicId, params.sessionId)
    } catch {
      return error(404, { message: "Forum session not found" })
    }
  })
  .get("/forum", async ({ params }) => {
    // Return the latest forum session ID from states
    const states = await getAllVersions(params.topicId)
    const latest = states.findLast(s => s.forum_session_id)
    if (!latest?.forum_session_id) return null
    try {
      return await getForumSession(params.topicId, latest.forum_session_id)
    } catch {
      return null
    }
  })
