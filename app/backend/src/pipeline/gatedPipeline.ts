import { join } from "path"
import { mkdir } from "fs/promises"
import { log } from "../utils/logger"
import { runDiscoveryAgent } from "../agents/DiscoveryAgent"
import { runEnrichmentAgent } from "../agents/EnrichmentAgent"
import { runWeightCalculator } from "../agents/WeightCalculator"
import { runForumOrchestrator } from "../agents/ForumOrchestrator"
import { generateExpertPersonas, runExpertAgent, runCrossDeliberation } from "../agents/ExpertAgent"
import { runVerdictSynthesizer } from "../agents/VerdictSynthesizer"
import { writeCheckpoint, readCheckpoint, isStageComplete } from "./checkpointManager"
import { createVersion } from "./stateManager"
import { readArtifact } from "../tools/internal/artifactStore"
import { emit } from "../routes/stream"
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
  const expertCount = topic.settings?.expert_count as number ?? 6

  log.separator()
  log.pipeline(`Starting ANALYSIS (weight→forum→expert→verdict) for "${topic.title}"`, `run=${runId}`)
  log.separator()
  const pipelineStart = Date.now()

  try {
    // Stage 3: Weight
    if (!isStageComplete(checkpoint, "weight")) {
      log.weight("Stage 3/6: WEIGHT CALCULATION starting")
      emit(topicId, { type: "progress", stage: "weight", pct: 0, msg: "Calculating weights..." })

      await runWeightCalculator(
        topicId, topic.title, topic.models.enrichment, runId,
        (msg) => emit(topicId, { type: "progress", stage: "weight", pct: 0.5, msg })
      )

      // Emit weight results for live UI
      try {
        const weightedParties = await Bun.file(join(getDataDir(), "topics", topicId, "parties.json")).json()
        emit(topicId, { type: "weight_result", parties: weightedParties.map((p: any) => ({ name: p.name, weight: p.weight })) })
      } catch { /* non-fatal */ }

      await writeCheckpoint(topicId, runId, { stage: "forum", step: 0 })
      log.weight("Stage 3/6: WEIGHT CALCULATION complete")
      emit(topicId, { type: "stage_complete", stage: "weight" })
    } else { log.weight("Stage 3/6: WEIGHT skipped (checkpoint)") }

    // Stage 4: Forum
    if (!isStageComplete(checkpoint, "forum")) {
      await updateTopicStatus(topicId, "forum")
      log.forum("Stage 4/6: FORUM starting")
      emit(topicId, { type: "progress", stage: "forum", pct: 0, msg: "Starting forum..." })

      const forumCheckpoint = await readCheckpoint(topicId, runId)
      await runForumOrchestrator(
        topicId, runId, sessionId, topic.models.forum_reasoning, forumCheckpoint,
        (msg) => emit(topicId, { type: "progress", stage: "forum", pct: 0.5, msg })
      )

      await writeCheckpoint(topicId, runId, { stage: "expert_council", step: 0 })
      log.forum("Stage 4/6: FORUM complete")
    } else { log.forum("Stage 4/6: FORUM skipped (checkpoint)") }

    // Stage 5: Expert Council
    if (!isStageComplete(checkpoint, "expert_council")) {
      await updateTopicStatus(topicId, "expert_council")
      log.expert("Stage 5/6: EXPERT COUNCIL starting")
      emit(topicId, { type: "progress", stage: "expert_council", pct: 0, msg: "Convening expert council..." })

      const experts = generateExpertPersonas(topic.title, expertCount)
      log.expert(`Generated ${experts.length} expert personas: ${experts.map(e => e.name).join(", ")}`)

      const BATCH = 3
      for (let i = 0; i < experts.length; i += BATCH) {
        const batch = experts.slice(i, i + BATCH)
        await Promise.all(batch.map(async expert => {
          await runExpertAgent(topicId, runId, expert, sessionId, topic.models.expert_council,
            (msg) => emit(topicId, { type: "progress", stage: "expert_council", pct: (i + 1) / experts.length, msg })
          )
          try {
            const artifact = await readArtifact(topicId, runId, `expert_${expert.domain}`)
            const summary = artifact?.scenarios_assessed?.[0]?.assessment?.slice(0, 200) || ""
            emit(topicId, { type: "expert_assessment", expert: expert.name, domain: expert.domain, summary })
          } catch { /* non-fatal */ }
        }))
      }

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

    // Stage 6: Verdict
    await updateTopicStatus(topicId, "verdict")
    log.verdict("Stage 6/6: VERDICT SYNTHESIS starting")
    emit(topicId, { type: "progress", stage: "verdict", pct: 0, msg: "Synthesizing final verdict..." })

    const experts = generateExpertPersonas(topic.title, expertCount)
    const councilOutput = await runVerdictSynthesizer(
      topicId, runId, experts, sessionId, topic.models.verdict,
      (msg) => emit(topicId, { type: "progress", stage: "verdict", pct: 0.5, msg })
    )

    // Emit verdict content for live UI
    try {
      const verdictArtifact = await readArtifact(topicId, runId, "verdict")
      if (verdictArtifact?.scenarios_ranked) {
        emit(topicId, {
          type: "verdict_content",
          headline: verdictArtifact.headline_assessment || "",
          scenarios: verdictArtifact.scenarios_ranked.map((s: any) => ({ title: s.scenario_title, probability: s.probability })),
        })
      }
    } catch { /* non-fatal */ }

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

// Clean re-analysis: wipe old analysis artifacts, run fresh Weight → Forum → Expert → Verdict
export async function runReanalysis(topicId: string): Promise<{ run_id: string; status: string }> {
  const topic = await loadTopic(topicId)
  // Use next version number for the new run
  const nextVersion = topic.current_version + 1
  const runId = `reanalysis-v${nextVersion}`
  const sessionId = `forum-session-v${nextVersion}`

  log.separator()
  log.pipeline(`Starting CLEAN RE-ANALYSIS for "${topic.title}"`, `run=${runId}, session=${sessionId}`)
  log.separator()

  // Clear the checkpoint for this run so all stages run fresh
  const checkpointDir = join(getDataDir(), "topics", topicId, "logs", `run-${runId}`)
  await mkdir(checkpointDir, { recursive: true })

  // Now run the full analysis pipeline from weight onwards (no checkpoint resume)
  const expertCount = topic.settings?.expert_count as number ?? 6
  const pipelineStart = Date.now()

  try {
    // Stage 3: Weight (re-score with updated parties/clues)
    log.weight("Stage 3/6: WEIGHT CALCULATION starting (fresh)")
    emit(topicId, { type: "progress", stage: "weight", pct: 0, msg: "Re-scoring party weights..." })

    await runWeightCalculator(
      topicId, topic.title, topic.models.enrichment, runId,
      (msg) => emit(topicId, { type: "progress", stage: "weight", pct: 0.5, msg })
    )

    // Emit weight results for live UI
    try {
      const weightedParties = await Bun.file(join(getDataDir(), "topics", topicId, "parties.json")).json()
      emit(topicId, { type: "weight_result", parties: weightedParties.map((p: any) => ({ name: p.name, weight: p.weight })) })
    } catch { /* non-fatal */ }

    log.weight("Stage 3/6: WEIGHT CALCULATION complete")
    emit(topicId, { type: "stage_complete", stage: "weight" })

    // Stage 4: Forum (fresh session)
    await updateTopicStatus(topicId, "forum")
    log.forum("Stage 4/6: FORUM starting (fresh)")
    emit(topicId, { type: "progress", stage: "forum", pct: 0, msg: "Starting fresh forum..." })

    await runForumOrchestrator(
      topicId, runId, sessionId, topic.models.forum_reasoning, null,
      (msg) => emit(topicId, { type: "progress", stage: "forum", pct: 0.5, msg })
    )

    log.forum("Stage 4/6: FORUM complete")

    // Stage 5: Expert Council
    await updateTopicStatus(topicId, "expert_council")
    log.expert("Stage 5/6: EXPERT COUNCIL starting (fresh)")
    emit(topicId, { type: "progress", stage: "expert_council", pct: 0, msg: "Convening expert council..." })

    const experts = generateExpertPersonas(topic.title, expertCount)
    log.expert(`Generated ${experts.length} expert personas: ${experts.map(e => e.name).join(", ")}`)

    const BATCH = 3
    for (let i = 0; i < experts.length; i += BATCH) {
      const batch = experts.slice(i, i + BATCH)
      await Promise.all(batch.map(async expert => {
        await runExpertAgent(topicId, runId, expert, sessionId, topic.models.expert_council,
          (msg) => emit(topicId, { type: "progress", stage: "expert_council", pct: (i + 1) / experts.length, msg })
        )
        try {
          const artifact = await readArtifact(topicId, runId, `expert_${expert.domain}`)
          const summary = artifact?.scenarios_assessed?.[0]?.assessment?.slice(0, 200) || ""
          emit(topicId, { type: "expert_assessment", expert: expert.name, domain: expert.domain, summary })
        } catch { /* non-fatal */ }
      }))
    }

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

    log.expert("Stage 5/6: EXPERT COUNCIL complete")
    emit(topicId, { type: "stage_complete", stage: "expert_council" })

    // Stage 6: Verdict
    await updateTopicStatus(topicId, "verdict")
    log.verdict("Stage 6/6: VERDICT SYNTHESIS starting (fresh)")
    emit(topicId, { type: "progress", stage: "verdict", pct: 0, msg: "Synthesizing verdict..." })

    const councilOutput = await runVerdictSynthesizer(
      topicId, runId, experts, sessionId, topic.models.verdict,
      (msg) => emit(topicId, { type: "progress", stage: "verdict", pct: 0.5, msg })
    )

    // Emit verdict content for live UI
    try {
      const verdictArtifact = await readArtifact(topicId, runId, "verdict")
      if (verdictArtifact?.scenarios_ranked) {
        emit(topicId, {
          type: "verdict_content",
          headline: verdictArtifact.headline_assessment || "",
          scenarios: verdictArtifact.scenarios_ranked.map((s: any) => ({ title: s.scenario_title, probability: s.probability })),
        })
      }
    } catch { /* non-fatal */ }

    await createVersion(topicId, {
      label: `Re-analysis v${nextVersion}`,
      trigger: "reanalysis",
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
    // Reset status to stale so user can retry
    await updateTopicStatus(topicId, "stale")
    emit(topicId, { type: "error", message: String(e) })
    return { run_id: runId, status: `error: ${e}` }
  }
}
