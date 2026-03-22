import { chatCompletionText } from "../llm/proxyClient"
import { webSearch } from "../tools/external/webSearch"
import { httpFetch } from "../tools/external/httpFetch"
import { processClue } from "../tools/processing/clueProcessor"
import { storeClue } from "../tools/processing/storeClue"
import { writeArtifact } from "../tools/internal/artifactStore"
import { buildAgentContext, serializeContext } from "./contextBuilder"
import { join } from "path"
import type { Party } from "./DiscoveryAgent"

export interface EnrichmentOutput {
  topic_id: string
  run_id: string
  enriched_party_ids: string[]
  new_clue_ids: string[]
  total_clues_after: number
}

const ENRICH_PARTY_SYSTEM = `You are enriching a party profile for geopolitical analysis.

Given a party and existing context, return a JSON object with updated/enriched fields:
{
  "description": "<improved 2-3 sentence description with specific details>",
  "means": ["<specific lever of power>", ...],
  "circle": {
    "visible": ["<specific named ally/proxy/outlet>", ...],
    "shadow": ["<inferred hidden actor with brief reason>", ...]
  },
  "vulnerabilities": ["<specific documented weak point>", ...]
}

Be specific and factual. No invention. Output ONLY the JSON object.`

function getDataDir() { return process.env.DATA_DIR || "/home/nima/dana/data" }

async function readJSON<T>(path: string): Promise<T> {
  const f = Bun.file(path)
  if (!(await f.exists())) throw new Error(`File not found: ${path}`)
  return f.json() as Promise<T>
}

async function writeJSON(path: string, data: unknown): Promise<void> {
  await Bun.write(path, JSON.stringify(data, null, 2))
}

export async function runEnrichmentAgent(
  topicId: string,
  title: string,
  description: string,
  models: { enrichment: string; extraction: string },
  runId: string,
  onProgress?: (msg: string) => void
): Promise<EnrichmentOutput> {
  const topicContext = `${title}: ${description}`
  const partiesPath = join(getDataDir(), "topics", topicId, "parties.json")
  const parties = await readJSON<Party[]>(partiesPath)
  const ctx = await buildAgentContext("enrichment", topicId)
  const contextStr = serializeContext(ctx)

  const enrichedIds: string[] = []
  const newClueIds: string[] = []

  // Enrich each party in parallel (cap at 6 concurrent)
  const BATCH = 4
  for (let i = 0; i < parties.length; i += BATCH) {
    const batch = parties.slice(i, i + BATCH)
    await Promise.all(batch.map(async (party) => {
      try {
        onProgress?.(`Enrichment: enriching party "${party.name}"`)

        // Step A: Deepen party profile via LLM
        const prompt = `CONTEXT:\n${contextStr}\n\nPARTY TO ENRICH:\n${JSON.stringify({ id: party.id, name: party.name, type: party.type, description: party.description, agenda: party.agenda }, null, 2)}`
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

        // Step B: Search for 2 recent clues about this party
        const query = `${party.name} ${title} recent news 2025 2026`
        const results = await webSearch(query, 3)
        for (const result of results.slice(0, 2)) {
          try {
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
            if (stored.status === "created") newClueIds.push(stored.clue_id)
          } catch { /* skip */ }
        }
      } catch { /* skip failed party enrichment */ }
    }))
  }

  // Write enriched parties back
  await writeJSON(partiesPath, parties)
  onProgress?.(`Enrichment: enriched ${enrichedIds.length} parties, added ${newClueIds.length} new clues`)

  // Count total clues
  const cluesPath = join(getDataDir(), "topics", topicId, "clues.json")
  const allClues = await readJSON<unknown[]>(cluesPath)

  const output: EnrichmentOutput = {
    topic_id: topicId,
    run_id: runId,
    enriched_party_ids: enrichedIds,
    new_clue_ids: newClueIds,
    total_clues_after: allClues.length,
  }

  await writeArtifact(topicId, runId, "enrichment_output", output)
  return output
}
