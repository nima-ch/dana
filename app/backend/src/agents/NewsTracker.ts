import { chatCompletionText } from "../llm/proxyClient"
import { budgetOutput } from "../llm/tokenBudget"
import { loadPrompt } from "../llm/promptLoader"
import { webSearch } from "../tools/external/webSearch"
import { httpFetch } from "../tools/external/httpFetch"
import { processClue } from "../tools/processing/clueProcessor"
import { storeClue } from "../tools/processing/storeClue"
import { selectRecentResults } from "../tools/external/searchUtils"
import { emitThink } from "../routes/stream"
import { log } from "../utils/logger"
import { dbGetParties } from "../db/queries/parties"

export interface NewsTrackerResult {
  news_clue_ids: string[]
}

const DEFAULT_NEWS_WINDOW_DAYS = 90

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function currentYear(): string {
  return new Date().getFullYear().toString()
}

function currentMonthYear(): string {
  return new Date().toLocaleString("en-US", { month: "long", year: "numeric" })
}

function domainOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, "") } catch { return url }
}

export async function runNewsTracker(
  topicId: string,
  title: string,
  description: string,
  model: string,
  runId: string,
  newsWindowDays: number = DEFAULT_NEWS_WINDOW_DAYS,
  onProgress?: (msg: string) => void
): Promise<NewsTrackerResult> {
  const today = todayStr()
  const year = currentYear()
  const currentMonth = currentMonthYear()
  const topicContext = `${title}: ${description}`
  const titleKeywords = title.toLowerCase().split(/\s+/).filter(w => w.length >= 4)
  const parties = dbGetParties(topicId)
  const newsClueIds: string[] = []

  log.enrichment(`NewsTracker: ${parties.length} parties, window=${newsWindowDays} days`)
  emitThink(topicId, "📰", "News Tracker", `Scanning last ${newsWindowDays} days for each party…`)

  const BATCH = 3
  for (let i = 0; i < parties.length; i += BATCH) {
    const batch = parties.slice(i, i + BATCH)
    await Promise.all(batch.map(async (party) => {
      try {
        emitThink(topicId, "📡", `News scan · ${party.name}`, "Generating recency-focused queries…")
        onProgress?.(`News tracking: ${party.name}`)
        log.enrichment(`NewsTracker: ${party.name}`)

        // Step 1: Generate recency-focused queries
        const NEWS_QUERIES_PROMPT = loadPrompt("enrichment/news-queries", {
          today,
          year,
          current_month: currentMonth,
          window_days: String(newsWindowDays),
          topic: title,
          party_name: party.name,
          party_type: party.type,
          agenda: party.agenda.slice(0, 150),
          stance: party.stance,
        })

        const queriesRaw = await chatCompletionText({
          model,
          messages: [
            { role: "system", content: NEWS_QUERIES_PROMPT },
            { role: "user", content: `Generate recent news queries for ${party.name}.` },
          ],
          temperature: 0.3,
          max_tokens: 250,
        })

        let queries: string[] = []
        try {
          const match = queriesRaw.match(/\[[\s\S]+\]/)
          if (match) queries = JSON.parse(match[0])
        } catch { /* fallback */ }
        if (queries.length === 0) {
          queries = [
            `${party.name} ${title} ${currentMonth}`,
            `${party.name} latest news ${year}`,
          ]
        }

        log.enrichment(`  ${party.name}: ${queries.length} news queries`)

        // Step 2: Search with recency requirement
        const findings: { url: string; title: string; summary: string; credibility: number; biasFlags: string[]; originSource: { url: string; outlet: string; is_republication: boolean }; keyPoints: string[]; date: string }[] = []

        for (const query of queries.slice(0, 3)) {
          try {
            await new Promise(r => setTimeout(r, 400))
            emitThink(topicId, "🔎", `News search · ${party.name}`, query)
            const candidates = await webSearch(query, 8)
            const selected = selectRecentResults(candidates, titleKeywords, 3, newsWindowDays)

            for (const result of selected) {
              try {
                emitThink(topicId, "📄", `Reading · ${domainOf(result.url)}`, result.title || "")
                const fetched = await httpFetch(result.url, topicId)
                const slim = await processClue(fetched.raw_content, result.url, topicContext, undefined, true)

                if (slim.relevance_score < 45) {
                  log.enrichment(`    Skipped (relevance ${slim.relevance_score}): ${result.url}`)
                  continue
                }

                // Full extraction
                const full = await processClue(fetched.raw_content, result.url, topicContext, model, false)
                findings.push({
                  url: result.url,
                  title: result.title || fetched.title || "Untitled",
                  summary: full.bias_corrected_summary,
                  credibility: full.source_credibility_score,
                  biasFlags: full.bias_flags,
                  originSource: full.origin_source,
                  keyPoints: full.key_points,
                  date: full.date_references[0] || result.date || today,
                })
                emitThink(topicId, "📰", `News found · ${result.title || domainOf(result.url)}`, `relevance ${slim.relevance_score}`)
                log.enrichment(`    News finding: ${result.url} (rel=${slim.relevance_score})`)
              } catch (e) {
                log.enrichment(`    Fetch/process failed: ${result.url}: ${e}`)
              }
            }
          } catch (e) {
            log.enrichment(`    News search failed for "${query}": ${e}`)
          }
        }

        if (findings.length === 0) {
          log.enrichment(`  ${party.name}: no news findings`)
          return
        }

        // Step 3: Synthesize into NEWS clues
        emitThink(topicId, "🗞️", `Synthesizing news · ${party.name}`, `${findings.length} sources`)
        log.enrichment(`  ${party.name}: synthesizing ${findings.length} news findings`)

        const findingsBlock = findings
          .map(f => `[${f.originSource.outlet || domainOf(f.url)}] (${f.date}) ${f.title}: ${f.summary.slice(0, 300)}`)
          .join("\n")

        const SYNTH_PROMPT = loadPrompt("enrichment/synthesize-news", {
          today,
          topic: title,
          party_name: party.name,
          party_id: party.id,
          party_type: party.type,
          window_days: String(newsWindowDays),
          findings: findingsBlock,
        })

        const synthBudget = budgetOutput(model, SYNTH_PROMPT, { min: 1000, max: 3000 })
        const synthRaw = await chatCompletionText({
          model,
          messages: [
            { role: "system", content: SYNTH_PROMPT },
            { role: "user", content: `Synthesize NEWS clues for ${party.name} from recent findings.` },
          ],
          temperature: 0.2,
          max_tokens: synthBudget,
        })

        try {
          const match = synthRaw.match(/\[[\s\S]+\]/)
          if (!match) throw new Error("No JSON array")
          const newsClues = JSON.parse(match[0]) as {
            title: string; summary: string; date: string; relevance: number
            credibility: number; parties: string[]; source_urls: string[]
            source_outlets: string[]; bias_flags: string[]; clue_type: string
            domain_tags: string[]; key_points: string[]
          }[]

          for (const clue of newsClues) {
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
              clueType: clue.clue_type || "news",
              addedBy: "auto",
              changeNote: `News tracker: synthesized from ${findings.length} sources (window: ${newsWindowDays}d)`,
            })

            if (stored.status === "created") {
              newsClueIds.push(stored.clue_id)
              emitThink(topicId, "📌", `News clue · ${clue.title.slice(0, 60)}`, `cred=${clue.credibility}`)
              log.enrichment(`    News clue stored: ${stored.clue_id} "${clue.title.slice(0, 50)}"`)
            }
          }
        } catch (e) {
          log.enrichment(`  ${party.name}: news synthesis parse failed: ${e}`)
        }

      } catch (e) {
        log.enrichment(`NewsTracker failed for ${party.name}: ${e}`)
      }
    }))
  }

  log.enrichment(`NewsTracker complete: ${newsClueIds.length} news clues stored`)
  return { news_clue_ids: newsClueIds }
}
