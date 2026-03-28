import { chatCompletionText } from "../llm/proxyClient"
import { budgetOutput } from "../llm/tokenBudget"
import { loadPrompt } from "../llm/promptLoader"
import { webSearch } from "../tools/external/webSearch"
import { httpFetch } from "../tools/external/httpFetch"
import { processClue } from "../tools/processing/clueProcessor"
import { selectBestResults } from "../tools/external/searchUtils"
import { emitThink } from "../routes/stream"
import { log } from "../utils/logger"
import { dbGetClues, dbUpdateClueVersion } from "../db/queries/clues"
import { getDb } from "../db/database"

export interface FactCheckerResult {
  checked: number
  verified: number
  disputed: number
  misleading: number
  skipped: number
}

// Clues with credibility >= this AND no bias flags are skipped (already high-confidence)
const HIGH_CONFIDENCE_THRESHOLD = 80

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function currentYear(): string {
  return new Date().getFullYear().toString()
}

function domainOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, "") } catch { return url }
}

export async function runFactChecker(
  topicId: string,
  title: string,
  description: string,
  model: string,
  runId: string,
  onProgress?: (msg: string) => void
): Promise<FactCheckerResult> {
  const today = todayStr()
  const year = currentYear()
  const topicContext = `${title}: ${description}`
  const titleKeywords = title.toLowerCase().split(/\s+/).filter(w => w.length >= 4)

  const allClues = dbGetClues(topicId)
  const result: FactCheckerResult = { checked: 0, verified: 0, disputed: 0, misleading: 0, skipped: 0 }

  // Determine which clues to check
  const toCheck = allClues.filter(clue => {
    const cur = clue.versions.find(v => v.v === clue.current)
    if (!cur) return false
    const cred = cur.source_credibility.score
    const flags = cur.source_credibility.bias_flags
    const hasFlags = flags.length > 0 && !flags.every(f => f === "none")
    // Skip high-confidence clues with no bias signals
    if (cred >= HIGH_CONFIDENCE_THRESHOLD && !hasFlags) return false
    // Skip already-checked disputed clues
    if (clue.status === "disputed") return false
    return true
  })

  log.enrichment(`FactChecker: ${toCheck.length} clues to check (${allClues.length - toCheck.length} skipped as high-confidence)`)
  emitThink(topicId, "🔍", "Fact Checker", `Verifying ${toCheck.length} clues…`)
  onProgress?.(`Fact-checking ${toCheck.length} clues…`)

  const BATCH = 4
  for (let i = 0; i < toCheck.length; i += BATCH) {
    const batch = toCheck.slice(i, i + BATCH)
    await Promise.all(batch.map(async (clue) => {
      const cur = clue.versions.find(v => v.v === clue.current)
      if (!cur) return

      result.checked++

      try {
        emitThink(topicId, "🔎", `Fact-checking · ${cur.title.slice(0, 50)}`, `cred=${cur.source_credibility.score}`)
        log.enrichment(`FactChecker: checking "${cur.title.slice(0, 60)}"`)

        // Step 1: Generate counter-evidence queries
        const FCQUERIES_PROMPT = loadPrompt("enrichment/fact-check-queries", {
          today,
          year,
          topic: title,
          clue_title: cur.title,
          clue_summary: cur.bias_corrected_summary.slice(0, 300),
          clue_source: cur.source_credibility.origin_source?.outlet || domainOf(cur.raw_source.url),
          clue_credibility: String(cur.source_credibility.score),
          bias_flags: cur.source_credibility.bias_flags.join(", ") || "none",
        })

        const queriesRaw = await chatCompletionText({
          model,
          messages: [
            { role: "system", content: FCQUERIES_PROMPT },
            { role: "user", content: `Generate verification queries for: "${cur.title}"` },
          ],
          temperature: 0.2,
          max_tokens: 200,
        })

        let queries: string[] = []
        try {
          const match = queriesRaw.match(/\[[\s\S]+\]/)
          if (match) queries = JSON.parse(match[0])
        } catch { /* fallback */ }
        if (queries.length === 0) {
          queries = [`${cur.title} verification ${year}`, `${cur.title} disputed false ${year}`]
        }

        // Step 2: Gather counter-evidence
        const counterEvidence: string[] = []

        for (const query of queries.slice(0, 2)) {
          try {
            await new Promise(r => setTimeout(r, 400))
            const candidates = await webSearch(query, 5)
            const selected = selectBestResults(candidates, titleKeywords, 2)

            for (const result of selected) {
              try {
                const fetched = await httpFetch(result.url, topicId)
                const slim = await processClue(fetched.raw_content, result.url, topicContext, undefined, true)
                if (slim.relevance_score < 40) continue
                counterEvidence.push(`[${domainOf(result.url)}] ${result.title}: ${slim.bias_corrected_summary.slice(0, 250)}`)
              } catch { /* skip */ }
            }
          } catch { /* skip */ }
        }

        if (counterEvidence.length === 0) {
          log.enrichment(`  No counter-evidence found for "${cur.title.slice(0, 40)}", marking verified`)
          result.verified++
          updateClueStatus(topicId, clue.id, "verified", cur.source_credibility.score, cur.source_credibility.bias_flags, cur.title, cur.bias_corrected_summary, "Fact-check: no contradicting sources found")
          return
        }

        // Step 3: LLM verdict
        const VERDICT_PROMPT = loadPrompt("enrichment/fact-check-verdict", {
          today,
          topic: title,
          clue_title: cur.title,
          clue_summary: cur.bias_corrected_summary.slice(0, 400),
          clue_source: cur.source_credibility.origin_source?.outlet || domainOf(cur.raw_source.url),
          clue_credibility: String(cur.source_credibility.score),
          bias_flags: cur.source_credibility.bias_flags.join(", ") || "none",
          parties: cur.party_relevance.join(", "),
          counter_evidence: counterEvidence.join("\n"),
        })

        const verdictBudget = budgetOutput(model, VERDICT_PROMPT, { min: 400, max: 1000 })
        const verdictRaw = await chatCompletionText({
          model,
          messages: [
            { role: "system", content: VERDICT_PROMPT },
            { role: "user", content: `Assess this claim: "${cur.title}"` },
          ],
          temperature: 0.2,
          max_tokens: verdictBudget,
        })

        try {
          const match = verdictRaw.match(/\{[\s\S]+\}/)
          if (!match) throw new Error("No JSON")
          const verdict = JSON.parse(match[0]) as {
            verdict: "verified" | "disputed" | "misleading"
            updated_title: string
            updated_summary: string
            updated_credibility: number
            updated_bias_flags: string[]
            verdict_note: string
            change_note: string
          }

          const newStatus = verdict.verdict === "verified" ? "verified" : "disputed"
          const emoji = verdict.verdict === "verified" ? "✅" : verdict.verdict === "misleading" ? "⚠️" : "🔶"

          emitThink(topicId, emoji, `${verdict.verdict.toUpperCase()} · ${cur.title.slice(0, 50)}`, verdict.verdict_note)
          log.enrichment(`  ${verdict.verdict.toUpperCase()}: "${cur.title.slice(0, 50)}" — ${verdict.verdict_note}`)

          updateClueStatus(
            topicId, clue.id, newStatus,
            verdict.updated_credibility, verdict.updated_bias_flags,
            verdict.updated_title, verdict.updated_summary,
            verdict.change_note,
          )

          if (verdict.verdict === "verified") result.verified++
          else if (verdict.verdict === "disputed") result.disputed++
          else result.misleading++

        } catch (e) {
          log.enrichment(`  Verdict parse failed for "${cur.title.slice(0, 40)}": ${e}`)
          result.skipped++
        }

      } catch (e) {
        log.enrichment(`FactChecker error for "${cur.title.slice(0, 40)}": ${e}`)
        result.skipped++
      }
    }))
  }

  // Count clues skipped as high-confidence
  result.skipped += allClues.length - toCheck.length

  log.enrichment(`FactChecker complete: ${result.verified} verified, ${result.disputed} disputed, ${result.misleading} misleading, ${result.skipped} skipped`)
  emitThink(topicId, "✅", "Fact-check complete", `${result.verified} verified · ${result.disputed} disputed · ${result.misleading} misleading`)

  return result
}

function updateClueStatus(
  topicId: string,
  clueId: string,
  status: "verified" | "disputed",
  credibility: number,
  biasFlags: string[],
  title: string,
  summary: string,
  changeNote: string,
): void {
  try {
    // Update the clue_versions row
    dbUpdateClueVersion(topicId, clueId, {
      title,
      bias_corrected_summary: summary,
      change_note: changeNote,
      source_credibility: {
        score: credibility,
        notes: changeNote,
        bias_flags: biasFlags,
        origin_source: { url: "", outlet: "", is_republication: false },
      },
    })
    // Update the status on the clue row itself
    getDb().run(
      "UPDATE clues SET status = ?, last_updated_at = ? WHERE id = ? AND topic_id = ?",
      [status, new Date().toISOString(), clueId, topicId]
    )
  } catch (e) {
    log.enrichment(`  Failed to update clue ${clueId} status: ${e}`)
  }
}
