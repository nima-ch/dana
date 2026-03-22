import { Elysia, t } from "elysia"
import { listTopics, getTopic, createTopic, updateTopic, deleteTopic } from "../pipeline/topicManager"

export const topicsRouter = new Elysia({ prefix: "/api/topics" })
  .get("/", async () => {
    return listTopics()
  })
  .get("/:id", async ({ params, error }) => {
    try {
      return await getTopic(params.id)
    } catch {
      return error(404, { message: "Topic not found" })
    }
  })
  .post("/", async ({ body, error }) => {
    try {
      return await createTopic(body)
    } catch (e) {
      return error(400, { message: String(e) })
    }
  }, {
    body: t.Object({
      title: t.String({ minLength: 1 }),
      description: t.String(),
      models: t.Optional(t.Record(t.String(), t.String())),
      settings: t.Optional(t.Record(t.String(), t.Any())),
    })
  })
  .put("/:id", async ({ params, body, error }) => {
    try {
      return await updateTopic(params.id, body)
    } catch {
      return error(404, { message: "Topic not found" })
    }
  }, {
    body: t.Partial(t.Object({
      title: t.String(),
      description: t.String(),
      status: t.String(),
      models: t.Record(t.String(), t.String()),
      settings: t.Record(t.String(), t.Any()),
    }))
  })
  .delete("/:id", async ({ params, error }) => {
    try {
      await deleteTopic(params.id)
      return { success: true }
    } catch {
      return error(404, { message: "Topic not found" })
    }
  })
