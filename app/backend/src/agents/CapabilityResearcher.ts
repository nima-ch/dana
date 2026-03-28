import { chatCompletionText } from "../llm/proxyClient"
import { budgetOutput } from "../llm/tokenBudget"
import { loadPrompt } from "../llm/promptLoader"
import { webSearch } from "../tools/external/webSearch"
import { httpFetch } from "../tools/external/httpFetch"
import { processClue } from "../tools/processing/clueProcessor"
import { storeClue } from "../tools/processing/storeClue"
import { selectBestResults } from "../tools/external/searchUtils"
import { emitThink } from "../routes/stream"
import { log } from "../utils/logger"
import { dbGetParties, dbSetParties } from "../db/queries/parties"
import type { Party } from "./DiscoveryAgent"

export interface CapabilityResearchResult {
  enriched_party_ids: string[]
  fact_clue_ids: string[]
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function currentYear(): string {
  return new Date().getFullYear().toString()
}

function domainOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, "") } catch { return url }
}

export async function runCapabilityResearcher(
  topicId: string,
  title: string,
  description: string,
  model: string,
  runId: string,
  onProgress?: (msg: string) => void
): Promise<CapabilityResearchResult> {
  const today = todayStr()
  const year = currentYear()
  const topicContext = `${title}: ${description}`
  const titleKeywords = title.toLowerCase().split(/\s+/).filter(w => w.length >= 4)
  const parties = dbGetParties(topicId)

  const enrichedIds: string[] = []
  const factClueIds: string[] = []

  log.enrichment(`CapabilityResearcher: ${parties.length} parties to research`)

  const BATCH = 3
  for (let i = 0; i < parties.length; i += BATCH) {
    const batch = parties.slice(i, i + BATCH)
    await Promise.all(batch.map(async (party) => {
      try {
        emitThink(topicId, "🔬", `Capability research · ${party.name}`, "Generating targeted queries…")
        onProgress?.(`Capability research: ${party.name}`)
        log.enrichment(`Capability research: ${party.name}`)

        // Step 1: Generate capability-targeted queries from agenda + means
        const QUERIES_PROMPT = loadPrompt("enrichment/capability-queries", {
          today,
          year,
          topic: title,
          party_name: party.name,
          party_type: party.type,
          agenda: party.agenda.slice(0, 200),
          means: party.means.slice(0, 5).join(", "),
        })

        const queriesRaw = await chatCompletionText({
          model,
          messages: [
            { role: "system", content: QUERIES_PROMPT },
            { role: "user", content: `Generate capability-focused search queries for ${party.name}.` },
          ],
          temperature: 0.3,
          max_tokens: 300,
        })

        let queries: string[] = []
        try {
          const match = queriesRaw.match(/\[[\s\S]+\]/)
          if (match) queries = JSON.parse(match[0])
        } catch { /* fallback */ }
        if (queries.length === 0) {
          queries = [
            `${party.name} capabilities resources ${year}`,
            `${party.name} policy position ${title} ${year}`,
          ]
        }

        log.enrichment(`  ${party.name}: ${queries.length} capability queries`)

        // Step 2: Search, screen with slim processClue, collect findings
        const findings: { url: string; title: string; summary: string; credibility: number; biasFlags: string[]; outlet: string; date: string }[] = []

        for (const query of queries.slice(0, 4)) {
          try {
            await new Promise(r => setTimeout(r, 400))
            emitThink(topicId, "🔎", `Searching · ${party.name}`, query)
            const candidates = await webSearch(query, 6)
            const selected = selectBestResults(candidates, titleKeywords, 2)

            for (const result of selected) {
              try {
                emitThink(topicId, "📄", `Reading · ${domainOf(result.url)}`, result.title || "")
                const fetched = await httpFetch(result.url, topicId)
                const slim = await processClue(fetched.raw_content, result.url, topicContext, undefined, true)

                if (slim.relevance_score < 50) {
                  log.enrichment(`    Skipped (relevance ${slim.relevance_score}): ${result.url}`)
                  continue
                }

                // Full extraction for storage
                const full = await processClue(fetched.raw_content, result.url, topicContext, model, false)
                findings.push({
                  url: result.url,
                  title: result.title || fetched.title || "Untitled",
                  summary: full.bias_corrected_summary,
                  credibility: full.source_credibility_score,
                  biasFlags: full.bias_flags,
                  outlet: full.origin_source.outlet || domainOf(result.url),
                  date: full.date_references[0] || today,
                })
                emitThink(topicId, "💡", `Fact found · ${result.title || domainOf(result.url)}`, `relevance ${slim.relevance_score}`)
                log.enrichment(`    Fact finding: ${result.url} (rel=${slim.relevance_score}, cred=${full.source_credibility_score})`)
              } catch (e) {
                log.enrichment(`    Fetch/process failed: ${result.url}: ${e}`)
              }
            }
          } catch (e) {
            log.enrichment(`    Search failed for "${query}": ${e}`)
          }
        }

        if (findings.length === 0) {
          log.enrichment(`  ${party.name}: no findings, skipping synthesis`)
          return
        }

        // Step 3: Synthesize findings into structured FACT clues
        emitThink(topicId, "🧪", `Synthesizing facts · ${party.name}`, `${findings.length} sources`)
        log.enrichment(`  ${party.name}: synthesizing ${findings.length} findings into FACT clues`)

        const findingsBlock = findings
          .map(f => `[${f.outlet}] (${f.date}) ${f.title}: ${f.summary.slice(0, 300)}`)
          .join("\n")

        const SYNTH_PROMPT = loadPrompt("enrichment/synthesize-facts", {
          today,
          topic: title,
          party_name: party.name,
          party_id: party.id,
          party_type: party.type,
          findings: findingsBlock,
        })

        const synthBudget = budgetOutput(model, SYNTH_PROMPT, { min: 1000, max: 3000 })
        const synthRaw = await chatCompletionText({
          model,
          messages: [
            { role: "system", content: SYNTH_PROMPT },
            { role: "user", content: `Synthesize FACT clues for ${party.name} from the research findings.` },
          ],
          temperature: 0.2,
          max_tokens: synthBudget,
        })

        try {
          const match = synthRaw.match(/\[[\s\S]+\]/)
          if (!match) throw new Error("No JSON array")
          const factClues = JSON.parse(match[0]) as {
            title: string; summary: string; date: string; relevance: number
            credibility: number; parties: string[]; source_urls: string[]
            source_outlets: string[]; bias_flags: string[]; domain_tags: string[]
            key_points: string[]
          }[]

          for (const clue of factClues) {
            const primaryUrl = clue.source_urls[0] || findings[0]?.url || ""
            const stored = await storeClue({
              topicId,
              title: clue.title,
              sourceUrl: primaryUrl,
              fetchedAt: new Date().toISOString(),
              processed: {
                extracted_content: "",
                bias_corrected_summary: clue.summary,
                bias_flags: clue.bias_flags,
                source_credibility_score: clue.credibility,
                credibility_notes: `Synthesized from ${clue.source_outlets.join(", ")}`,
                origin_source: {
                  url: primaryUrl,
                  outlet: clue.source_outlets[0] || domainOf(primaryUrl),
                  is_republication: false,
                },
                key_points: clue.key_points,
                date_references: [clue.date],
                relevance_score: clue.relevance,
              },
              partyRelevance: clue.parties.length > 0 ? clue.parties : [party.id],
              domainTags: clue.domain_tags,
              timelineDate: clue.date,
              clueType: "fact",
              addedBy: "auto",
              changeNote: `Capability research: synthesized from ${findings.length} sources`,
            })

            if (stored.status === "created") {
              factClueIds.push(stored.clue_id)
              emitThink(topicId, "📌", `Fact clue · ${clue.title.slice(0, 60)}`, `cred=${clue.credibility}`)
              log.enrichment(`    Fact clue stored: ${stored.clue_id} "${clue.title.slice(0, 50)}"`)
            }
          }
        } catch (e) {
          log.enrichment(`  ${party.name}: fact synthesis parse failed: ${e}`)
        }

        // Step 4: Update party profile from findings
        const profileUpdatePrompt = loadPrompt("enrichment/enrich-party")
        const profileCtx = `CONTEXT:\nTOPIC: ${title}\n\nPARTY TO ENRICH:\n${JSON.stringify({ id: party.id, name: party.name, type: party.type, description: party.description, agenda: party.agenda }, null, 2)}\n\nRESEARCH FINDINGS:\n${findingsBlock.slice(0, 3000)}`

        const profileRaw = await chatCompletionText({
          model,
          messages: [
            { role: "system", content: profileUpdatePrompt },
            { role: "user", content: profileCtx },
          ],
          temperature: 0.2,
          max_tokens: 800,
        })

        try {
          const match = profileRaw.match(/\{[\s\S]+\}/)
          if (match) {
            const enriched = JSON.parse(match[0]) as Partial<Party>
            Object.assign(party, enriched)
            enrichedIds.push(party.id)
            log.enrichment(`  ${party.name}: profile updated from capability research`)
          }
        } catch { /* keep original */ }

      } catch (e) {
        log.enrichment(`CapabilityResearcher failed for ${party.name}: ${e}`)
      }
    }))
  }

  // Save enriched profiles back to DB
  dbSetParties(topicId, parties)
  log.enrichment(`CapabilityResearcher complete: ${enrichedIds.length} profiles enriched, ${factClueIds.length} fact clues stored`)

  return { enriched_party_ids: enrichedIds, fact_clue_ids: factClueIds }
}
