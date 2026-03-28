import { writeArtifact } from "../tools/internal/artifactStore"
import { log } from "../utils/logger"
import { dbCountClues } from "../db/queries/clues"
import { emit } from "../routes/stream"
import { runCapabilityResearcher } from "./CapabilityResearcher"
import { runNewsTracker } from "./NewsTracker"
import { runFactChecker } from "./FactChecker"

export interface EnrichmentOutput {
  topic_id: string
  run_id: string
  enriched_party_ids: string[]
  fact_clue_ids: string[]
  news_clue_ids: string[]
  fact_check: { verified: number; disputed: number; misleading: number; skipped: number }
  total_clues_after: number
}

export async function runEnrichmentAgent(
  topicId: string,
  title: string,
  description: string,
  models: { enrichment: string; extraction: string },
  runId: string,
  onProgress?: (msg: string) => void
): Promise<EnrichmentOutput> {
  log.separator()
  log.enrichment(`Starting enrichment for "${title}"`)
  log.enrichment(`Models: enrichment=${models.enrichment} extraction=${models.extraction}`)
  log.separator()

  // ── Agent 1: Capability & Agenda Researcher ──────────────────────────────
  log.enrichment("Agent 1/3: CAPABILITY RESEARCHER starting")
  emit(topicId, { type: "progress", stage: "enrichment", pct: 0.1, msg: "Researching party capabilities and agendas…" })

  const capResult = await runCapabilityResearcher(
    topicId, title, description, models.enrichment, runId,
    (msg) => { onProgress?.(msg); emit(topicId, { type: "progress", stage: "enrichment", pct: 0.2, msg }) }
  )
  log.enrichment(`Agent 1/3 complete: ${capResult.enriched_party_ids.length} profiles enriched, ${capResult.fact_clue_ids.length} fact clues`)
  emit(topicId, { type: "progress", stage: "enrichment", pct: 0.35, msg: `${capResult.fact_clue_ids.length} fact clues gathered` })

  // ── Agent 2: News Tracker ────────────────────────────────────────────────
  log.enrichment("Agent 2/3: NEWS TRACKER starting")
  emit(topicId, { type: "progress", stage: "enrichment", pct: 0.4, msg: "Tracking recent news for each party…" })

  const newsResult = await runNewsTracker(
    topicId, title, description, models.enrichment, runId,
    undefined,  // use default 90-day window
    (msg) => { onProgress?.(msg); emit(topicId, { type: "progress", stage: "enrichment", pct: 0.55, msg }) }
  )
  log.enrichment(`Agent 2/3 complete: ${newsResult.news_clue_ids.length} news clues`)
  emit(topicId, { type: "progress", stage: "enrichment", pct: 0.65, msg: `${newsResult.news_clue_ids.length} news clues gathered` })

  // ── Agent 3: Fact Checker ────────────────────────────────────────────────
  log.enrichment("Agent 3/3: FACT CHECKER starting")
  emit(topicId, { type: "progress", stage: "enrichment", pct: 0.7, msg: "Fact-checking and bias assessment…" })

  const fcResult = await runFactChecker(
    topicId, title, description, models.enrichment, runId,
    (msg) => { onProgress?.(msg); emit(topicId, { type: "progress", stage: "enrichment", pct: 0.85, msg }) }
  )
  log.enrichment(`Agent 3/3 complete: ${fcResult.verified} verified, ${fcResult.disputed} disputed, ${fcResult.misleading} misleading`)
  emit(topicId, { type: "progress", stage: "enrichment", pct: 0.95, msg: "Fact-check complete" })

  // ── Finalize ─────────────────────────────────────────────────────────────
  const totalCluesAfter = dbCountClues(topicId)
  const allNewClueIds = [...capResult.fact_clue_ids, ...newsResult.news_clue_ids]

  onProgress?.(`Enrichment complete: ${allNewClueIds.length} clues (${capResult.fact_clue_ids.length} facts, ${newsResult.news_clue_ids.length} news)`)
  log.separator()
  log.enrichment(`Enrichment COMPLETE: ${allNewClueIds.length} total clues, ${totalCluesAfter} in DB`)
  log.separator()

  const output: EnrichmentOutput = {
    topic_id: topicId,
    run_id: runId,
    enriched_party_ids: capResult.enriched_party_ids,
    fact_clue_ids: capResult.fact_clue_ids,
    news_clue_ids: newsResult.news_clue_ids,
    fact_check: {
      verified: fcResult.verified,
      disputed: fcResult.disputed,
      misleading: fcResult.misleading,
      skipped: fcResult.skipped,
    },
    total_clues_after: totalCluesAfter,
  }

  await writeArtifact(topicId, runId, "enrichment_output", output)
  return output
}
