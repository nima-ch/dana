import { mkdir } from "fs/promises"
import { join } from "path"
import { log } from "../utils/logger"
import { runDiscoveryAgent } from "../agents/DiscoveryAgent"
import { runEnrichmentAgent } from "../agents/EnrichmentAgent"
import { runForumPrep } from "../agents/WeightCalculator"
import { runForumOrchestrator } from "../agents/ForumOrchestrator"
import { runScenarioScorer } from "../agents/ScenarioScorer"
import { writeCheckpoint, readCheckpoint, isStageComplete } from "./checkpointManager"
import { createVersion } from "./stateManager"

import { emit } from "../routes/stream"
import { getTopic, updateTopic } from "./topicManager"
import { dbGetParties } from "../db/queries/parties"
import type { Topic } from "./topicManager"

function getDataDir() { return process.env.DATA_DIR || "/home/nima/dana/data" }

async function updateTopicStatus(topicId: string, status: Topic["status"]) {
  await updateTopic(topicId, { status })
}

async function loadTopic(topicId: string): Promise<Topic> {
  return getTopic(topicId)
}

// Stage 1 only: Discovery → review_parties
export async function runDiscoverStage(topicId: string): Promise<{ status: string }> {
  const topic = await loadTopic(topicId)
  const runId = `initial-v${topic.current_version + 1}`

  log.separator()
  log.pipeline(`Starting DISCOVERY for "${topic.title}"`, `run=${runId}`)
  log.separator()

  try {
    await updateTopicStatus(topicId, "discovery")
    emit(topicId, { type: "progress", stage: "discovery", pct: 0, msg: "Starting discovery..." })

    await runDiscoveryAgent(
      topicId, topic.title, topic.description,
      topic.models.enrichment, runId,
      (msg) => emit(topicId, { type: "progress", stage: "discovery", pct: 0.5, msg })
    )

    await writeCheckpoint(topicId, runId, { stage: "enrichment", step: 0 })
    await updateTopicStatus(topicId, "review_parties")

    log.discovery("Discovery complete — awaiting user review of parties")
    emit(topicId, { type: "stage_complete", stage: "discovery" })

    return { status: "review_parties" }
  } catch (e) {
    log.error("DISCOVERY", "Discovery failed", e)
    emit(topicId, { type: "error", message: String(e) })
    return { status: `error: ${e}` }
  }
}

// Stage 2 only: Enrichment → review_enrichment
export async function runEnrichStage(topicId: string): Promise<{ status: string }> {
  const topic = await loadTopic(topicId)
  const runId = `initial-v${topic.current_version + 1}`

  log.separator()
  log.pipeline(`Starting ENRICHMENT for "${topic.title}"`, `run=${runId}`)
  log.separator()

  try {
    await updateTopicStatus(topicId, "enrichment")
    emit(topicId, { type: "progress", stage: "enrichment", pct: 0, msg: "Starting enrichment..." })

    await runEnrichmentAgent(
      topicId, topic.title, topic.description,
      { enrichment: topic.models.enrichment, extraction: topic.models.extraction },
      runId,
      (msg) => emit(topicId, { type: "progress", stage: "enrichment", pct: 0.5, msg })
    )

    await writeCheckpoint(topicId, runId, { stage: "weight", step: 0 })
    await updateTopicStatus(topicId, "review_enrichment")

    log.enrichment("Enrichment complete — awaiting user review of clues")
    emit(topicId, { type: "stage_complete", stage: "enrichment" })

    return { status: "review_enrichment" }
  } catch (e) {
    log.error("ENRICHMENT", "Enrichment failed", e)
    emit(topicId, { type: "error", message: String(e) })
    return { status: `error: ${e}` }
  }
}

// Stages 3-6: Weight → Forum → Expert → Verdict (autonomous)
export async function runAnalyzeStages(topicId: string): Promise<{ run_id: string; status: string }> {
  const topic = await loadTopic(topicId)
  const runId = `initial-v${topic.current_version + 1}`
  const checkpoint = await readCheckpoint(topicId, runId)
  const sessionId = `forum-session-v${topic.current_version + 1}`

  log.separator()
  log.pipeline(`Starting ANALYSIS (weight→forum→scoring) for "${topic.title}"`, `run=${runId}`)
  log.separator()
  const pipelineStart = Date.now()

  try {
    // Stage 3: Forum Prep (persona generation + speaking budgets)
    if (!isStageComplete(checkpoint, "forum_prep") && !isStageComplete(checkpoint, "weight")) {
      log.weight("Stage 3/5: FORUM PREP starting")
      emit(topicId, { type: "progress", stage: "forum_prep", pct: 0, msg: "Generating forum representatives..." })

      await runForumPrep(
        topicId, topic.title, topic.models.enrichment, runId,
        (msg) => emit(topicId, { type: "progress", stage: "forum_prep", pct: 0.5, msg })
      )

      try {
        const parties = dbGetParties(topicId)
        emit(topicId, { type: "weight_result", parties: parties.map(p => ({ name: p.name, weight: p.weight })) })
      } catch { /* non-fatal */ }

      await writeCheckpoint(topicId, runId, { stage: "forum", step: 0 })
      log.weight("Stage 3/5: FORUM PREP complete")
      emit(topicId, { type: "stage_complete", stage: "forum_prep" })
    } else { log.weight("Stage 3/5: FORUM PREP skipped (checkpoint)") }

    // Stage 4: Forum
    if (!isStageComplete(checkpoint, "forum")) {
      await updateTopicStatus(topicId, "forum")
      log.forum("Stage 4/5: FORUM starting")
      emit(topicId, { type: "progress", stage: "forum", pct: 0, msg: "Starting forum..." })

      const forumCheckpoint = await readCheckpoint(topicId, runId)
      await runForumOrchestrator(
        topicId, runId, sessionId, topic.models.forum_reasoning, forumCheckpoint,
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
    log.pipeline(`Analysis COMPLETE in ${totalElapsed}s`, `run=${runId}`)
    log.separator()

    return { run_id: runId, status: "complete" }
  } catch (e) {
    log.error("PIPELINE", "Analysis FAILED", e)
    // Reset to review_enrichment so user can retry
    await updateTopicStatus(topicId, "review_enrichment")
    emit(topicId, { type: "error", message: String(e) })
    return { run_id: runId, status: `error: ${e}` }
  }
}

// Clean re-analysis: wipe old analysis artifacts, run fresh Weight → Forum → Scoring
export async function runReanalysis(topicId: string): Promise<{ run_id: string; status: string }> {
  const topic = await loadTopic(topicId)
  const nextVersion = topic.current_version + 1
  const runId = `reanalysis-v${nextVersion}`
  const sessionId = `forum-session-v${nextVersion}`

  log.separator()
  log.pipeline(`Starting CLEAN RE-ANALYSIS for "${topic.title}"`, `run=${runId}, session=${sessionId}`)
  log.separator()

  const checkpointDir = join(getDataDir(), "topics", topicId, "logs", `run-${runId}`)
  await mkdir(checkpointDir, { recursive: true })

  const pipelineStart = Date.now()

  try {
    // Stage 3: Forum Prep (fresh persona generation)
    log.weight("Stage 3/5: FORUM PREP starting (fresh)")
    emit(topicId, { type: "progress", stage: "forum_prep", pct: 0, msg: "Generating forum representatives..." })

    await runForumPrep(
      topicId, topic.title, topic.models.enrichment, runId,
      (msg) => emit(topicId, { type: "progress", stage: "forum_prep", pct: 0.5, msg })
    )

    try {
      const parties = dbGetParties(topicId)
      emit(topicId, { type: "weight_result", parties: parties.map(p => ({ name: p.name, weight: p.weight })) })
    } catch { /* non-fatal */ }

    log.weight("Stage 3/5: FORUM PREP complete")
    emit(topicId, { type: "stage_complete", stage: "forum_prep" })

    // Stage 4: Forum (fresh session)
    await updateTopicStatus(topicId, "forum")
    log.forum("Stage 4/5: FORUM starting (fresh)")
    emit(topicId, { type: "progress", stage: "forum", pct: 0, msg: "Starting fresh forum..." })

    await runForumOrchestrator(
      topicId, runId, sessionId, topic.models.forum_reasoning, null,
      (msg) => emit(topicId, { type: "progress", stage: "forum", pct: 0.5, msg })
    )

    log.forum("Stage 4/5: FORUM complete")

    // Stage 5: Scenario Scoring
    await updateTopicStatus(topicId, "expert_council")
    log.expert("Stage 5/5: SCENARIO SCORER starting (fresh)")
    emit(topicId, { type: "progress", stage: "expert_council", pct: 0, msg: "Scoring scenarios..." })

    const councilOutput = await runScenarioScorer(
      topicId, runId, sessionId, topic.models.expert_council,
      (msg) => emit(topicId, { type: "progress", stage: "expert_council", pct: 0.5, msg })
    )

    await createVersion(topicId, {
      label: `Re-analysis v${nextVersion}`,
      trigger: "user_manual",
      forum_session_id: sessionId,
      verdict_id: councilOutput.verdict_id,
    })

    await updateTopicStatus(topicId, "complete")
    emit(topicId, { type: "stage_complete", stage: "verdict" })

    const totalElapsed = Math.round((Date.now() - pipelineStart) / 1000)
    log.separator()
    log.pipeline(`Re-analysis COMPLETE in ${totalElapsed}s`, `run=${runId}`)
    log.separator()

    return { run_id: runId, status: "complete" }
  } catch (e) {
    log.error("PIPELINE", "Re-analysis FAILED", e)
    await updateTopicStatus(topicId, "stale")
    emit(topicId, { type: "error", message: String(e) })
    return { run_id: runId, status: `error: ${e}` }
  }
}
