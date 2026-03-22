import { Elysia } from "elysia"
import { getTopic } from "../pipeline/topicManager"
import { runInitialPipeline } from "../pipeline/initialPipeline"
import { runDeltaPipeline } from "../pipeline/deltaPipeline"
import { runDiscoverStage, runEnrichStage, runAnalyzeStages } from "../pipeline/gatedPipeline"

const activeRuns = new Map<string, { run_id: string; started_at: string }>()

export function getActiveRun(topicId: string) {
  return activeRuns.get(topicId) ?? null
}

function guardRunning(topicId: string) {
  if (activeRuns.has(topicId)) {
    return { running: true, run: activeRuns.get(topicId) }
  }
  return null
}

function trackRun(topicId: string, run_id: string) {
  const started_at = new Date().toISOString()
  activeRuns.set(topicId, { run_id, started_at })
  return { run_id, started_at }
}

export const pipelineRouter = new Elysia({ prefix: "/api/topics" })

  // Gated: Discovery only → review_parties
  .post("/:id/pipeline/discover", async ({ params, error }) => {
    const topicId = params.id
    try {
      const topic = await getTopic(topicId)
      if (topic.status !== "draft" && topic.status !== "complete") {
        return error(400, { message: `Cannot discover from status "${topic.status}"` })
      }
    } catch { return error(404, { message: "Topic not found" }) }

    const conflict = guardRunning(topicId)
    if (conflict) return error(409, { message: "Pipeline already running", ...conflict })

    const { run_id, started_at } = trackRun(topicId, "discover")

    runDiscoverStage(topicId).then(() => {
      activeRuns.delete(topicId)
    }).catch(() => { activeRuns.delete(topicId) })

    return { run_id, started_at, status: "started" }
  })

  // Gated: Enrichment only → review_enrichment
  .post("/:id/pipeline/enrich", async ({ params, error }) => {
    const topicId = params.id
    try {
      const topic = await getTopic(topicId)
      if (topic.status !== "review_parties") {
        return error(400, { message: `Cannot enrich from status "${topic.status}". Approve parties first.` })
      }
    } catch { return error(404, { message: "Topic not found" }) }

    const conflict = guardRunning(topicId)
    if (conflict) return error(409, { message: "Pipeline already running", ...conflict })

    const { run_id, started_at } = trackRun(topicId, "enrich")

    runEnrichStage(topicId).then(() => {
      activeRuns.delete(topicId)
    }).catch(() => { activeRuns.delete(topicId) })

    return { run_id, started_at, status: "started" }
  })

  // Gated: Weight → Forum → Expert → Verdict (autonomous)
  .post("/:id/pipeline/analyze", async ({ params, error }) => {
    const topicId = params.id
    try {
      const topic = await getTopic(topicId)
      if (topic.status !== "review_enrichment") {
        return error(400, { message: `Cannot analyze from status "${topic.status}". Approve clues first.` })
      }
    } catch { return error(404, { message: "Topic not found" }) }

    const conflict = guardRunning(topicId)
    if (conflict) return error(409, { message: "Pipeline already running", ...conflict })

    const { run_id, started_at } = trackRun(topicId, "analyze")

    runAnalyzeStages(topicId).then(result => {
      activeRuns.delete(topicId)
    }).catch(() => { activeRuns.delete(topicId) })

    return { run_id, started_at, status: "started" }
  })

  // Full auto-run (skips gates — chains all stages)
  .post("/:id/pipeline/run", async ({ params, error }) => {
    const topicId = params.id
    try { await getTopic(topicId) }
    catch { return error(404, { message: "Topic not found" }) }

    const conflict = guardRunning(topicId)
    if (conflict) return error(409, { message: "Pipeline already running", ...conflict })

    const { run_id, started_at } = trackRun(topicId, "initial-v1")

    runInitialPipeline(topicId).then(() => {
      activeRuns.delete(topicId)
    }).catch(() => { activeRuns.delete(topicId) })

    return { run_id, started_at, status: "started" }
  })

  // Delta update (stale topics)
  .post("/:id/pipeline/update", async ({ params, error }) => {
    const topicId = params.id
    try {
      const topic = await getTopic(topicId)
      if (topic.status !== "stale") {
        return error(400, { message: "Topic is not stale" })
      }
    } catch { return error(404, { message: "Topic not found" }) }

    const conflict = guardRunning(topicId)
    if (conflict) return error(409, { message: "Pipeline already running", ...conflict })

    const run_id = `delta-${Date.now().toString(36)}`
    const { started_at } = trackRun(topicId, run_id)

    runDeltaPipeline(topicId, run_id).then(() => {
      activeRuns.delete(topicId)
    }).catch(() => { activeRuns.delete(topicId) })

    return { run_id, started_at, status: "started" }
  })

  .get("/:id/pipeline/status", async ({ params }) => {
    const run = activeRuns.get(params.id)
    if (run) return { running: true, ...run }
    return { running: false }
  })
