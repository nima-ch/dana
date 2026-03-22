import { join } from "path"
import { runDiscoveryAgent } from "../agents/DiscoveryAgent"
import { runEnrichmentAgent } from "../agents/EnrichmentAgent"
import { runWeightCalculator } from "../agents/WeightCalculator"
import { runForumOrchestrator } from "../agents/ForumOrchestrator"
import { generateExpertPersonas, runExpertAgent, runCrossDeliberation } from "../agents/ExpertAgent"
import { runVerdictSynthesizer } from "../agents/VerdictSynthesizer"
import { writeCheckpoint, readCheckpoint, isStageComplete } from "./checkpointManager"
import { createVersion } from "./stateManager"
import { emit, makeProgressEmitter } from "../routes/stream"
import type { Topic } from "./topicManager"

function getDataDir() { return process.env.DATA_DIR || "/home/nima/dana/data" }

function topicPath(topicId: string) {
  return join(getDataDir(), "topics", topicId, "topic.json")
}

async function updateTopicStatus(topicId: string, status: Topic["status"]) {
  const f = Bun.file(topicPath(topicId))
  const topic = await f.json() as Topic
  topic.status = status
  topic.updated_at = new Date().toISOString()
  await Bun.write(topicPath(topicId), JSON.stringify(topic, null, 2))
}

async function loadTopic(topicId: string): Promise<Topic> {
  return Bun.file(topicPath(topicId)).json()
}

export async function runInitialPipeline(topicId: string, runId?: string): Promise<{ run_id: string; status: string }> {
  runId = runId ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const topic = await loadTopic(topicId)
  const checkpoint = await readCheckpoint(topicId, runId)
  const progress = makeProgressEmitter(topicId, "pipeline")
  const sessionId = "forum-session-v1"
  const expertCount = topic.settings?.expert_count as number ?? 6

  try {
    // Stage 1: Discovery
    if (!isStageComplete(checkpoint, "discovery")) {
      await updateTopicStatus(topicId, "discovery")
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
      emit(topicId, { type: "stage_complete", stage: "discovery" })
    }

    // Stage 2: Enrichment
    if (!isStageComplete(checkpoint, "enrichment")) {
      await updateTopicStatus(topicId, "enrichment")
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
      emit(topicId, { type: "stage_complete", stage: "enrichment" })
    }

    // Stage 3: Weight Calculation
    if (!isStageComplete(checkpoint, "weight")) {
      emit(topicId, { type: "progress", stage: "weight", pct: 0, msg: "Calculating weights..." })

      await runWeightCalculator(
        topicId,
        topic.title,
        topic.models.enrichment,
        runId,
        (msg) => emit(topicId, { type: "progress", stage: "weight", pct: 0.5, msg })
      )

      await writeCheckpoint(topicId, runId, { stage: "forum", step: 0 })
      emit(topicId, { type: "stage_complete", stage: "weight" })
    }

    // Stage 4: Forum
    if (!isStageComplete(checkpoint, "forum")) {
      await updateTopicStatus(topicId, "forum")
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
      // stage_complete for forum is emitted by ForumOrchestrator itself
    }

    // Stage 5: Expert Council
    if (!isStageComplete(checkpoint, "expert_council")) {
      await updateTopicStatus(topicId, "expert_council")
      emit(topicId, { type: "progress", stage: "expert_council", pct: 0, msg: "Convening expert council..." })

      const experts = generateExpertPersonas(topic.title, expertCount)

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
      emit(topicId, { type: "stage_complete", stage: "expert_council" })
    }

    // Stage 6: Verdict Synthesis
    await updateTopicStatus(topicId, "verdict")
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

    return { run_id: runId, status: "complete" }
  } catch (e) {
    console.error("Pipeline failed:", e)
    emit(topicId, { type: "error", message: String(e) })
    return { run_id: runId, status: `error: ${e}` }
  }
}
