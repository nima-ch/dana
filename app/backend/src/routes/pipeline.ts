import { Elysia } from "elysia"
import { getTopic } from "../pipeline/topicManager"
import { runInitialPipeline } from "../pipeline/initialPipeline"
import { runDeltaPipeline } from "../pipeline/deltaPipeline"

// Track active pipeline runs per topic
const activeRuns = new Map<string, { run_id: string; started_at: string }>()

export function getActiveRun(topicId: string) {
  return activeRuns.get(topicId) ?? null
}

export const pipelineRouter = new Elysia({ prefix: "/api/topics" })
  .post("/:id/pipeline/run", async ({ params, error }) => {
    const topicId = params.id
    try {
      await getTopic(topicId)
    } catch {
      return error(404, { message: "Topic not found" })
    }

    if (activeRuns.has(topicId)) {
      return error(409, { message: "Pipeline already running", run: activeRuns.get(topicId) })
    }

    // Start pipeline in background — return immediately with run_id
    const run_id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    const started_at = new Date().toISOString()
    activeRuns.set(topicId, { run_id, started_at })

    // Fire-and-forget the pipeline
    runInitialPipeline(topicId, run_id).then(result => {
      activeRuns.delete(topicId)
      console.log(`Pipeline completed for ${topicId}: ${result.status}`)
    }).catch(err => {
      activeRuns.delete(topicId)
      console.error(`Pipeline failed for ${topicId}:`, err)
    })

    return { run_id, started_at, status: "started" }
  })
  .post("/:id/pipeline/update", async ({ params, error }) => {
    const topicId = params.id
    try {
      const topic = await getTopic(topicId)
      if (topic.status !== "stale") {
        return error(400, { message: "Topic is not stale — nothing to update" })
      }
    } catch {
      return error(404, { message: "Topic not found" })
    }

    if (activeRuns.has(topicId)) {
      return error(409, { message: "Pipeline already running", run: activeRuns.get(topicId) })
    }

    const run_id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    const started_at = new Date().toISOString()
    activeRuns.set(topicId, { run_id, started_at })

    runDeltaPipeline(topicId, run_id).then(result => {
      activeRuns.delete(topicId)
      console.log(`Delta pipeline completed for ${topicId}: ${result.status}`)
    }).catch(err => {
      activeRuns.delete(topicId)
      console.error(`Delta pipeline failed for ${topicId}:`, err)
    })

    return { run_id, started_at, status: "started" }
  })
  .get("/:id/pipeline/status", async ({ params }) => {
    const run = activeRuns.get(params.id)
    if (run) return { running: true, ...run }
    return { running: false }
  })
