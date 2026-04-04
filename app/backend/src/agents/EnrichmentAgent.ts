import { writeArtifact } from "../tools/internal/artifactStore"
import { log } from "../utils/logger"
import { dbCountClues, dbGetClues, dbUpdateClueVersion } from "../db/queries/clues"
import { dbGetParties, dbSetParties } from "../db/queries/parties"
import { emit } from "../routes/stream"
import { emitThink } from "../routes/stream"
import { runPartyEnrichmentAgent } from "./PartyEnrichmentAgent"
import { getDb } from "../db/database"
import type { Party } from "./DiscoveryAgent"

export interface EnrichmentOutput {
  topic_id: string
  run_id: string
  enriched_party_ids: string[]
  clue_ids: string[]
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
  log.enrichment(`Model: ${models.enrichment}`)
  log.separator()

  const parties = dbGetParties(topicId)
  const allClueIds: string[] = []
  const enrichedPartyIds: string[] = []
  const factCheckTotals = { verified: 0, disputed: 0, misleading: 0, skipped: 0 }

  emit(topicId, { type: "progress", stage: "enrichment", pct: 0.05, msg: `Enriching ${parties.length} parties with agentic research…` })

  // Run per-party enrichment agents in batches of 2
  const BATCH = 2
  for (let i = 0; i < parties.length; i += BATCH) {
    const batch = parties.slice(i, i + BATCH)
    const pct = 0.1 + (i / parties.length) * 0.8

    emit(topicId, { type: "progress", stage: "enrichment", pct, msg: `Researching: ${batch.map(p => p.name).join(", ")}` })
    onProgress?.(`Enriching: ${batch.map(p => p.name).join(", ")}`)

    const results = await Promise.all(batch.map(async (party) => {
      const existingClues = getExistingCluesForParty(topicId, party.id)
      return runPartyEnrichmentAgent(
        topicId, title, description, party, existingClues, models.enrichment,
      )
    }))

    for (const result of results) {
      allClueIds.push(...result.storedClueIds)

      if (result.profileUpdate) {
        const party = parties.find(p => p.id === result.partyId)
        if (party) {
          Object.assign(party, result.profileUpdate)
          enrichedPartyIds.push(result.partyId)
          log.enrichment(`Profile updated: ${party.name}`)
        }
      }

      for (const fc of result.factCheckResults) {
        if (fc.verdict === "verified") factCheckTotals.verified++
        else if (fc.verdict === "disputed") {
          factCheckTotals.disputed++
          applyFactCheckVerdict(topicId, fc.clue_title, fc.verdict, fc.note)
        } else if (fc.verdict === "misleading") {
          factCheckTotals.misleading++
          applyFactCheckVerdict(topicId, fc.clue_title, fc.verdict, fc.note)
        }
      }
    }
  }

  // Save enriched party profiles back to DB
  dbSetParties(topicId, parties)

  // Orphan fact-check pass: review clues with no party association
  const orphanCount = runOrphanFactCheck(topicId, factCheckTotals)
  factCheckTotals.skipped += orphanCount

  const totalCluesAfter = dbCountClues(topicId)

  emit(topicId, { type: "progress", stage: "enrichment", pct: 1.0, msg: "Enrichment complete" })
  onProgress?.(`Enrichment complete: ${allClueIds.length} clues, ${enrichedPartyIds.length} profiles updated`)

  log.separator()
  log.enrichment(`Enrichment COMPLETE: ${allClueIds.length} clues stored, ${enrichedPartyIds.length} profiles enriched, ${totalCluesAfter} total in DB`)
  log.separator()

  const output: EnrichmentOutput = {
    topic_id: topicId,
    run_id: runId,
    enriched_party_ids: enrichedPartyIds,
    clue_ids: allClueIds,
    fact_check: factCheckTotals,
    total_clues_after: totalCluesAfter,
  }

  await writeArtifact(topicId, runId, "enrichment_output", output)
  return output
}

function getExistingCluesForParty(topicId: string, partyId: string) {
  const allClues = dbGetClues(topicId)
  return allClues
    .filter(clue => {
      const cur = clue.versions.find(v => v.v === clue.current)
      return cur?.party_relevance?.includes(partyId)
    })
    .map(clue => {
      const cur = clue.versions.find(v => v.v === clue.current)!
      return {
        id: clue.id,
        title: cur.title,
        summary: cur.bias_corrected_summary,
        credibility: cur.source_credibility.score,
        clue_type: cur.clue_type,
      }
    })
}

function applyFactCheckVerdict(topicId: string, clueTitle: string, verdict: string, note: string) {
  try {
    const allClues = dbGetClues(topicId)
    const clue = allClues.find(c => {
      const cur = c.versions.find(v => v.v === c.current)
      return cur?.title === clueTitle
    })
    if (!clue) return

    const status = verdict === "verified" ? "verified" : "disputed"
    dbUpdateClueVersion(topicId, clue.id, {
      change_note: `Fact-check: ${verdict} — ${note}`,
    })
    getDb().run(
      "UPDATE clues SET status = ?, last_updated_at = ? WHERE id = ? AND topic_id = ?",
      [status, new Date().toISOString(), clue.id, topicId]
    )
    emitThink(topicId, verdict === "disputed" ? "🔶" : "⚠️", `${verdict.toUpperCase()}: ${clueTitle.slice(0, 50)}`, note)
    log.enrichment(`Fact-check applied: ${verdict} for "${clueTitle.slice(0, 50)}"`)
  } catch (e) {
    log.enrichment(`Failed to apply fact-check verdict: ${e}`)
  }
}

function runOrphanFactCheck(topicId: string, totals: { skipped: number }) {
  const allClues = dbGetClues(topicId)
  const orphans = allClues.filter(c => {
    const cur = c.versions.find(v => v.v === c.current)
    return !cur?.party_relevance?.length
  })
  log.enrichment(`Orphan fact-check: ${orphans.length} clues with no party association (skipped)`)
  return orphans.length
}
