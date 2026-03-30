import { log } from "../utils/logger"
import { runDiscoveryAgent } from "../agents/DiscoveryAgent"
import { runEnrichmentAgent } from "../agents/EnrichmentAgent"
import { runWeightCalculator } from "../agents/WeightCalculator"
import { runForumOrchestrator } from "../agents/ForumOrchestrator"
import { runScenarioScorer } from "../agents/ScenarioScorer"
import { writeCheckpoint, readCheckpoint, isStageComplete } from "./checkpointManager"
import { createVersion } from "./stateManager"
import { emit, makeProgressEmitter } from "../routes/stream"
import { getTopic, updateTopic } from "./topicManager"
import type { Topic } from "./topicManager"

async function updateTopicStatus(topicId: string, status: Topic["status"]) {
  await updateTopic(topicId, { status })
}

async function loadTopic(topicId: string): Promise<Topic> {
  return getTopic(topicId)
}

export async function runInitialPipeline(topicId: string, runId?: string): Promise<{ run_id: string; status: string }> {
  const topic = await loadTopic(topicId)
  // Use deterministic runId so restarts resume from the same checkpoint
  runId = runId ?? `initial-v${topic.current_version + 1}`
  const checkpoint = await readCheckpoint(topicId, runId)
  const progress = makeProgressEmitter(topicId, "pipeline")
  const sessionId = "forum-session-v1"

  try {
    log.separator()
    log.pipeline(`Starting initial pipeline for "${topic.title}"`, `run=${runId}`)
    log.pipeline(`Models: enrichment=${topic.models.enrichment} forum=${topic.models.forum_reasoning} scorer=${topic.models.expert_council}`)
    log.separator()
    const pipelineStart = Date.now()

    // Stage 1: Discovery
    if (!isStageComplete(checkpoint, "discovery")) {
      await updateTopicStatus(topicId, "discovery")
      log.discovery("Stage 1/5: DISCOVERY starting")
      emit(topicId, { type: "progress", stage: "discovery", pct: 0, msg: "Starting discovery..." })

      await runDiscoveryAgent(
        topicId,
        topic.title,
        topic.description,
        topic.models.enrichment,
        runId,
        (msg) => emit(topicId, { type: "progress", stage: "discovery", pct: 0.5, msg })
      )

      await writeCheckpoint(topicId, runId, { stage: "enrichment", step: 0 })
      log.discovery("Stage 1/5: DISCOVERY complete")
      emit(topicId, { type: "stage_complete", stage: "discovery" })
    } else { log.discovery("Stage 1/6: DISCOVERY skipped (checkpoint)") }

    // Stage 2: Enrichment
    if (!isStageComplete(checkpoint, "enrichment")) {
      await updateTopicStatus(topicId, "enrichment")
      log.enrichment("Stage 2/5: ENRICHMENT starting")
      emit(topicId, { type: "progress", stage: "enrichment", pct: 0, msg: "Starting enrichment..." })

      await runEnrichmentAgent(
        topicId,
        topic.title,
        topic.description,
        { enrichment: topic.models.enrichment, extraction: topic.models.extraction },
        runId,
        (msg) => emit(topicId, { type: "progress", stage: "enrichment", pct: 0.5, msg })
      )

      await writeCheckpoint(topicId, runId, { stage: "weight", step: 0 })
      log.enrichment("Stage 2/5: ENRICHMENT complete")
      emit(topicId, { type: "stage_complete", stage: "enrichment" })
    } else { log.enrichment("Stage 2/6: ENRICHMENT skipped (checkpoint)") }

    // Stage 3: Weight Calculation
    if (!isStageComplete(checkpoint, "weight")) {
      log.weight("Stage 3/5: WEIGHT CALCULATION starting")
      emit(topicId, { type: "progress", stage: "weight", pct: 0, msg: "Calculating weights..." })

      await runWeightCalculator(
        topicId,
        topic.title,
        topic.models.enrichment,
        runId,
        (msg) => emit(topicId, { type: "progress", stage: "weight", pct: 0.5, msg })
      )

      await writeCheckpoint(topicId, runId, { stage: "forum", step: 0 })
      log.weight("Stage 3/5: WEIGHT CALCULATION complete")
      emit(topicId, { type: "stage_complete", stage: "weight" })
    } else { log.weight("Stage 3/5: WEIGHT CALCULATION skipped (checkpoint)") }

    // Stage 4: Forum
    if (!isStageComplete(checkpoint, "forum")) {
      await updateTopicStatus(topicId, "forum")
      log.forum("Stage 4/5: FORUM starting")
      emit(topicId, { type: "progress", stage: "forum", pct: 0, msg: "Starting forum..." })

      const forumCheckpoint = await readCheckpoint(topicId, runId)

      await runForumOrchestrator(
        topicId,
        runId,
        sessionId,
        topic.models.forum_reasoning,
        forumCheckpoint,
        (msg) => emit(topicId, { type: "progress", stage: "forum", pct: 0.5, msg })
      )

      await writeCheckpoint(topicId, runId, { stage: "expert_council", step: 0 })
      log.forum("Stage 4/5: FORUM complete")
    } else { log.forum("Stage 4/5: FORUM skipped (checkpoint)") }

    // Stage 5: Scenario Scoring
    await updateTopicStatus(topicId, "expert_council")
    log.expert("Stage 5/5: SCENARIO SCORER starting")
    emit(topicId, { type: "progress", stage: "expert_council", pct: 0, msg: "Scoring scenarios..." })

    const councilOutput = await runScenarioScorer(
      topicId, runId, sessionId, topic.models.expert_council,
      (msg) => emit(topicId, { type: "progress", stage: "expert_council", pct: 0.5, msg })
    )

    await createVersion(topicId, {
      label: "Initial analysis",
      trigger: "initial_run",
      forum_session_id: sessionId,
      verdict_id: councilOutput.verdict_id,
    })

    await updateTopicStatus(topicId, "complete")
    emit(topicId, { type: "stage_complete", stage: "verdict" })

    const totalElapsed = Math.round((Date.now() - pipelineStart) / 1000)
    log.separator()
    log.pipeline(`Pipeline COMPLETE in ${totalElapsed}s`, `run=${runId}`)
    log.separator()

    return { run_id: runId, status: "complete" }
  } catch (e) {
    log.error("PIPELINE", "Pipeline FAILED", e)
    emit(topicId, { type: "error", message: String(e) })
    return { run_id: runId, status: `error: ${e}` }
  }
}
