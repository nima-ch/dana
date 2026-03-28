import { chatCompletionText } from "../llm/proxyClient"
import { loadPrompt } from "../llm/promptLoader"
import { webSearch } from "../tools/external/webSearch"
import { httpFetch } from "../tools/external/httpFetch"
import { processClue } from "../tools/processing/clueProcessor"
import { storeClue } from "../tools/processing/storeClue"
import { writeArtifact } from "../tools/internal/artifactStore"
import { buildAgentContext, serializeContext } from "./contextBuilder"
import { log } from "../utils/logger"
import { dbGetParties, dbSetParties } from "../db/queries/parties"
import { dbCountClues } from "../db/queries/clues"
import { emitThink } from "../routes/stream"
import type { Party } from "./DiscoveryAgent"

export interface EnrichmentOutput {
  topic_id: string
  run_id: string
  enriched_party_ids: string[]
  new_clue_ids: string[]
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
  const ENRICH_PARTY_SYSTEM = loadPrompt("enrichment/enrich-party")
  const topicContext = `${title}: ${description}`
  const parties = dbGetParties(topicId)
  const ctx = await buildAgentContext("enrichment", topicId)
  const contextStr = serializeContext(ctx)

  const enrichedIds: string[] = []
  const newClueIds: string[] = []

  log.enrichment(`Enriching ${parties.length} parties, batch size=4`)

  // Enrich each party in parallel (cap at 6 concurrent)
  const BATCH = 4
  for (let i = 0; i < parties.length; i += BATCH) {
    const batch = parties.slice(i, i + BATCH)
    await Promise.all(batch.map(async (party) => {
      try {
        log.enrichment(`Enriching party: ${party.name}`)
        onProgress?.(`Enrichment: enriching party "${party.name}"`)
        emitThink(topicId, "🔬", `Enriching party · ${party.name}`)

        const prompt = `CONTEXT:\n${contextStr}\n\nPARTY TO ENRICH:\n${JSON.stringify({ id: party.id, name: party.name, type: party.type, description: party.description, agenda: party.agenda }, null, 2)}`
        emitThink(topicId, "🧠", `Deepening profile · ${party.name}`)
        const raw = await chatCompletionText({
          model: models.enrichment,
          messages: [
            { role: "system", content: ENRICH_PARTY_SYSTEM },
            { role: "user", content: prompt },
          ],
          temperature: 0.2,
          max_tokens: 800,
        })

        try {
          const match = raw.match(/\{[\s\S]+\}/)
          if (match) {
            const enriched = JSON.parse(match[0]) as Partial<Party>
            Object.assign(party, enriched)
            enrichedIds.push(party.id)
          }
        } catch { /* keep original if parse fails */ }

        const query = `${party.name} ${title} recent news 2025 2026`
        emitThink(topicId, "🔎", `Searching · ${party.name}`, query)
        await new Promise(r => setTimeout(r, 400))
        const results = await webSearch(query, 3)
        for (const result of results.slice(0, 2)) {
          try {
            const domain = (() => { try { return new URL(result.url).hostname.replace(/^www\./, "") } catch { return result.url } })()
            emitThink(topicId, "📄", `Reading · ${domain}`, result.title || "")
            const fetched = await httpFetch(result.url, topicId)
            const processed = await processClue(fetched.raw_content, result.url, topicContext, models.extraction)
            if (processed.relevance_score < 45) continue
            const stored = await storeClue({
              topicId,
              title: result.title || fetched.title,
              sourceUrl: result.url,
              fetchedAt: fetched.fetched_at,
              processed,
              partyRelevance: [party.id],
              addedBy: "auto",
            })
            if (stored.status === "created") {
              newClueIds.push(stored.clue_id)
              emitThink(topicId, "📌", `Clue stored · ${result.title || fetched.title || "Untitled"}`, `relevance ${processed.relevance_score}`)
            }
          } catch { /* skip */ }
        }
      } catch { /* skip failed party enrichment */ }
    }))
  }

  // Write enriched parties back to DB
  dbSetParties(topicId, parties)
  onProgress?.(`Enrichment: enriched ${enrichedIds.length} parties, added ${newClueIds.length} new clues`)

  const totalCluesAfter = dbCountClues(topicId)

  const output: EnrichmentOutput = {
    topic_id: topicId,
    run_id: runId,
    enriched_party_ids: enrichedIds,
    new_clue_ids: newClueIds,
    total_clues_after: totalCluesAfter,
  }

  await writeArtifact(topicId, runId, "enrichment_output", output)
  return output
}
