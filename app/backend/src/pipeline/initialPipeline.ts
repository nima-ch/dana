import { log } from "../utils/logger"
import { runDiscoveryAgent } from "../agents/DiscoveryAgent"
import { runEnrichmentAgent } from "../agents/EnrichmentAgent"
import { runWeightCalculator } from "../agents/WeightCalculator"
import { runForumOrchestrator } from "../agents/ForumOrchestrator"
import { generateExpertPersonas, runExpertAgent, runCrossDeliberation } from "../agents/ExpertAgent"
import { runVerdictSynthesizer } from "../agents/VerdictSynthesizer"
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
  const expertCount = topic.settings?.expert_count as number ?? 6

  try {
    log.separator()
    log.pipeline(`Starting initial pipeline for "${topic.title}"`, `run=${runId}`)
    log.pipeline(`Models: enrichment=${topic.models.enrichment} forum=${topic.models.forum_reasoning} expert=${topic.models.expert_council} verdict=${topic.models.verdict}`)
    log.separator()
    const pipelineStart = Date.now()

    // Stage 1: Discovery
    if (!isStageComplete(checkpoint, "discovery")) {
      await updateTopicStatus(topicId, "discovery")
      log.discovery("Stage 1/6: DISCOVERY starting")
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
      log.discovery("Stage 1/6: DISCOVERY complete")
      emit(topicId, { type: "stage_complete", stage: "discovery" })
    } else { log.discovery("Stage 1/6: DISCOVERY skipped (checkpoint)") }

    // Stage 2: Enrichment
    if (!isStageComplete(checkpoint, "enrichment")) {
      await updateTopicStatus(topicId, "enrichment")
      log.enrichment("Stage 2/6: ENRICHMENT starting")
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
      log.enrichment("Stage 2/6: ENRICHMENT complete")
      emit(topicId, { type: "stage_complete", stage: "enrichment" })
    } else { log.enrichment("Stage 2/6: ENRICHMENT skipped (checkpoint)") }

    // Stage 3: Weight Calculation
    if (!isStageComplete(checkpoint, "weight")) {
      log.weight("Stage 3/6: WEIGHT CALCULATION starting")
      emit(topicId, { type: "progress", stage: "weight", pct: 0, msg: "Calculating weights..." })

      await runWeightCalculator(
        topicId,
        topic.title,
        topic.models.enrichment,
        runId,
        (msg) => emit(topicId, { type: "progress", stage: "weight", pct: 0.5, msg })
      )

      await writeCheckpoint(topicId, runId, { stage: "forum", step: 0 })
      log.weight("Stage 3/6: WEIGHT CALCULATION complete")
      emit(topicId, { type: "stage_complete", stage: "weight" })
    } else { log.weight("Stage 3/6: WEIGHT CALCULATION skipped (checkpoint)") }

    // Stage 4: Forum
    if (!isStageComplete(checkpoint, "forum")) {
      await updateTopicStatus(topicId, "forum")
      log.forum("Stage 4/6: FORUM starting")
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
      log.forum("Stage 4/6: FORUM complete")
      // stage_complete for forum is emitted by ForumOrchestrator itself
    } else { log.forum("Stage 4/6: FORUM skipped (checkpoint)") }

    // Stage 5: Expert Council
    if (!isStageComplete(checkpoint, "expert_council")) {
      await updateTopicStatus(topicId, "expert_council")
      log.expert("Stage 5/6: EXPERT COUNCIL starting")
      emit(topicId, { type: "progress", stage: "expert_council", pct: 0, msg: "Convening expert council..." })

      const experts = generateExpertPersonas(topic.title, expertCount)
      log.expert(`Generated ${experts.length} expert personas: ${experts.map(e => e.name).join(", ")}`)

      // Run experts in parallel (batches of 3 to avoid rate limits)
      const BATCH = 3
      for (let i = 0; i < experts.length; i += BATCH) {
        const batch = experts.slice(i, i + BATCH)
        await Promise.all(batch.map(expert =>
          runExpertAgent(topicId, runId, expert, sessionId, topic.models.expert_council,
            (msg) => emit(topicId, { type: "progress", stage: "expert_council", pct: (i + 1) / experts.length, msg })
          )
        ))
      }

      // Cross-deliberation round
      log.expert("Cross-expert deliberation round starting")
      emit(topicId, { type: "progress", stage: "expert_council", pct: 0.8, msg: "Cross-expert deliberation..." })
      for (let i = 0; i < experts.length; i += BATCH) {
        const batch = experts.slice(i, i + BATCH)
        await Promise.all(batch.map(expert =>
          runCrossDeliberation(topicId, runId, expert, experts, topic.models.expert_council,
            (msg) => emit(topicId, { type: "progress", stage: "expert_council", pct: 0.9, msg })
          )
        ))
      }

      await writeCheckpoint(topicId, runId, { stage: "verdict", step: 0 })
      log.expert("Stage 5/6: EXPERT COUNCIL complete")
      emit(topicId, { type: "stage_complete", stage: "expert_council" })
    } else { log.expert("Stage 5/6: EXPERT COUNCIL skipped (checkpoint)") }

    // Stage 6: Verdict Synthesis
    await updateTopicStatus(topicId, "verdict")
    log.verdict("Stage 6/6: VERDICT SYNTHESIS starting")
    emit(topicId, { type: "progress", stage: "verdict", pct: 0, msg: "Synthesizing final verdict..." })

    const experts = generateExpertPersonas(topic.title, expertCount)
    const councilOutput = await runVerdictSynthesizer(
      topicId, runId, experts, sessionId, topic.models.verdict,
      (msg) => emit(topicId, { type: "progress", stage: "verdict", pct: 0.5, msg })
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
