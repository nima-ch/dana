import { chatCompletionText } from "../llm/proxyClient"
import { chatCompletionText } from "../llm/proxyClient"
import { budgetOutput } from "../llm/tokenBudget"
import { loadPrompt } from "../llm/promptLoader"
import { webSearch } from "../tools/external/webSearch"
import { httpFetch } from "../tools/external/httpFetch"
import { processClue } from "../tools/processing/clueProcessor"
import { emitThink } from "../routes/stream"
import { log } from "../utils/logger"
import { dbSetParties } from "../db/queries/parties"
import { writeArtifact } from "../tools/internal/artifactStore"
import type { SearchResult } from "../tools/external/webSearch"

export interface Party {
  id: string
  name: string
  type: "state" | "state_military" | "non_state" | "individual" | "media" | "economic" | "alliance"
  description: string
  weight: number
  weight_factors: {
    military_capacity: number
    economic_control: number
    information_control: number
    international_support: number
    internal_legitimacy: number
  }
  agenda: string
  means: string[]
  circle: { visible: string[]; shadow: string[] }
  stance: string
  vulnerabilities: string[]
  auto_discovered: boolean
  user_verified: boolean
}

// Raw research finding — stored in memory only during Discovery, never written to clue DB
interface ResearchFinding {
  url: string
  title: string
  snippet: string            // from search result
  summary: string            // from processClue (LLM extraction)
  relevance: number
  party_hint?: string        // set when fetching for a specific party in Step 4
  multi_source_summary?: string  // synthesized summary across multiple findings for the same query
}

export interface DiscoveryOutput {
  topic_id: string
  parties: Party[]
  research_findings: ResearchFinding[]
  search_queries: string[]
  run_id: string
}

async function parseWithRetry<T>(
  call: (hint?: string) => Promise<string>,
  parse: (raw: string) => T,
  validate: (v: T) => boolean,
  maxAttempts = 3
): Promise<T> {
  let lastError = ""
  for (let i = 0; i < maxAttempts; i++) {
    const hint = i > 0 ? `Previous attempt failed: ${lastError}. Output ONLY valid JSON. No trailing commas. No markdown fences.` : undefined
    const raw = await call(hint)
    try {
      const v = parse(raw)
      if (!validate(v)) throw new Error("Validation failed")
      return v
    } catch (e) {
      lastError = String(e)
      log.discovery(`parseWithRetry attempt ${i + 1} failed: ${lastError}`)
    }
  }
  throw new Error(`Failed after ${maxAttempts} attempts: ${lastError}`)
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30)
}

function domainOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, "") } catch { return url }
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function currentYear(): string {
  return new Date().getFullYear().toString()
}

// Score a search result by recency and keyword relevance to the topic title
function scoreResult(result: SearchResult, titleKeywords: string[]): number {
  let score = 0

  // Recency boost: prefer results with a date field within last 12 months
  if (result.date) {
    try {
      const ageMs = Date.now() - new Date(result.date).getTime()
      const ageMonths = ageMs / (1000 * 60 * 60 * 24 * 30)
      if (ageMonths <= 3) score += 40
      else if (ageMonths <= 6) score += 25
      else if (ageMonths <= 12) score += 15
    } catch { /* ignore unparseable dates */ }
  }

  // Keyword relevance: title and snippet overlap with topic keywords
  const text = `${result.title} ${result.snippet}`.toLowerCase()
  for (const kw of titleKeywords) {
    if (text.includes(kw)) score += 10
  }

  return score
}

// Select best results: highest-scored, plus guarantee at least one most-recent result
function selectBestResults(results: SearchResult[], titleKeywords: string[], maxPick = 2): SearchResult[] {
  if (results.length === 0) return []

  const scored = results.map(r => ({ r, score: scoreResult(r, titleKeywords) }))
  scored.sort((a, b) => b.score - a.score)

  const picked: SearchResult[] = [scored[0].r]

  // If the top result is not the most-recent one, also include the most-recent
  const withDate = results.filter(r => r.date)
  if (withDate.length > 0) {
    const mostRecent = withDate.sort((a, b) =>
      new Date(b.date!).getTime() - new Date(a.date!).getTime()
    )[0]
    if (mostRecent.url !== picked[0].url) picked.push(mostRecent)
  }

  // Fill up to maxPick with next highest-scored results not already picked
  for (const { r } of scored) {
    if (picked.length >= maxPick) break
    if (!picked.find(p => p.url === r.url)) picked.push(r)
  }

  return picked.slice(0, maxPick)
}

// Synthesize multiple findings for a query into a single cited summary
async function synthesizeFindings(
  findings: ResearchFinding[],
  query: string,
  topicContext: string,
  model: string
): Promise<string | null> {
  if (findings.length < 2) return null

  const sourcesBlock = findings
    .slice(0, 5)
    .map(f => `[${domainOf(f.url)}] ${f.title}: ${f.summary.slice(0, 300)}`)
    .join("\n")

  try {
    const raw = await chatCompletionText({
      model,
      messages: [
        {
          role: "system",
          content: "You are a neutral intelligence analyst. Synthesize the following sources into a single concise paragraph (3-5 sentences) that captures the key facts relevant to the topic. Cite each source domain inline like (source.com). Output ONLY the paragraph, no preamble.",
        },
        {
          role: "user",
          content: `TOPIC: ${topicContext}\nSEARCH ANGLE: ${query}\n\nSOURCES:\n${sourcesBlock}`,
        },
      ],
      temperature: 0.2,
      max_tokens: 300,
    })
    return raw.trim()
  } catch {
    return null
  }
}

// Build a concise research summary from in-memory findings for the LLM.
// Prefers multi_source_summary (synthesized across findings) over individual summaries.
function formatFindings(findings: ResearchFinding[], max = 60): string {
  return findings
    .slice(0, max)
    .map(f => {
      const src = domainOf(f.url)
      const text = f.multi_source_summary || f.summary || f.snippet
      return `[${src}] ${f.title}: ${text.slice(0, 300)}`
    })
    .join("\n")
}

// Generate smart search queries for a specific party based on its profile
// Snippet-only — no httpFetch needed for party research
function partyResearchQueries(party: Party, title: string, year: string): string[] {
  // Skip media/think-tank parties — they have no geopolitical footprint worth researching
  if (party.type === "media") return []

  const queries: string[] = []

  if (["state", "state_military", "alliance"].includes(party.type)) {
    // For state/military actors: look for their specific role + adversarial context
    const agendaSlice = party.agenda.slice(0, 80).replace(/[^\w\s]/g, "")
    queries.push(`${party.name} ${agendaSlice} ${year}`)
    queries.push(`${party.name} rivals sanctions military pressure ${year}`)
  } else if (party.type === "economic") {
    // For economic actors: look for their market position and key decisions
    queries.push(`${party.name} ${title} decision policy ${year}`)
  } else {
    queries.push(`${party.name} ${title} ${year}`)
  }

  return queries
}

export async function runDiscoveryAgent(
  topicId: string,
  title: string,
  description: string,
  model: string,
  runId: string,
  onProgress?: (msg: string) => void
): Promise<DiscoveryOutput> {
  const today = todayStr()
  const year = currentYear()
  const topicContext = `${title}: ${description}`
  const findings: ResearchFinding[] = []
  const allSearchQueries: string[] = []

  // ─────────────────────────────────────────────
  // STEP 1: Orient — understand topic, plan searches across all axes
  // ─────────────────────────────────────────────
  log.discovery(`Starting discovery for "${title}" on ${today}`)
  emitThink(topicId, "📅", `Today is ${today}`, "Orienting research…")
  onProgress?.(`Discovery: orienting for "${title}"`)

  const ORIENT_PROMPT = loadPrompt("discovery/orient", { today, year })
  const orientInput = `TOPIC: ${title}\n\nDESCRIPTION: ${description}`

  emitThink(topicId, "🧠", "Analyzing topic angles", "Economic · Geopolitical · Military · Adversarial…")

  const orientBudget = budgetOutput(model, ORIENT_PROMPT + orientInput, { min: 800, max: 2000 })
  const orientation = await parseWithRetry<{ angles: string[]; likely_party_types: string[]; seed_queries: string[] }>(
    async (hint) => chatCompletionText({
      model,
      messages: [
        { role: "system", content: ORIENT_PROMPT },
        { role: "user", content: orientInput + (hint ? `\n\n${hint}` : "") },
      ],
      temperature: 0.3,
      max_tokens: orientBudget,
    }),
    (raw) => {
      const match = raw.match(/\{[\s\S]+\}/)
      if (!match) throw new Error("No JSON object found")
      return JSON.parse(match[0])
    },
    (v) => Array.isArray(v.seed_queries) && v.seed_queries.length >= 3
  )

  log.discovery(`Orientation: ${orientation.angles.length} angles, ${orientation.seed_queries.length} queries`)
  emitThink(topicId, "🗺️", `${orientation.angles.length} angles identified`, orientation.angles.slice(0, 3).join(" · "))
  allSearchQueries.push(...orientation.seed_queries)

  // Pre-compute topic keywords for scoring (lowercase words ≥4 chars)
  const titleKeywords = title.toLowerCase().split(/\s+/).filter(w => w.length >= 4)

  // ─────────────────────────────────────────────
  // STEP 2: Broad research — scored selection + multi-source synthesis
  //   - Search 8 candidates per query, pick best 2 by recency + relevance
  //   - After fetching, synthesize findings per query into a single cited summary
  // ─────────────────────────────────────────────
  onProgress?.(`Discovery: broad research across ${orientation.seed_queries.length} queries`)

  for (const query of orientation.seed_queries.slice(0, 8)) {
    try {
      // Small inter-query delay to avoid DDG rate-limiting
      await new Promise(r => setTimeout(r, 400))
      emitThink(topicId, "🔎", `Searching`, query)
      onProgress?.(`Discovery: searching "${query}"`)
      const candidates = await webSearch(query, 8)
      log.discovery(`Search "${query}" → ${candidates.length} candidates`)

      const selected = selectBestResults(candidates, titleKeywords, 2)
      log.discovery(`  Selected ${selected.length} best results (recency + relevance scored)`)

      const queryFindings: ResearchFinding[] = []

      for (const result of selected) {
        try {
          emitThink(topicId, "📄", `Reading · ${domainOf(result.url)}`, result.title || result.snippet?.slice(0, 80) || "")
          const fetched = await httpFetch(result.url, topicId)
          const processed = await processClue(fetched.raw_content, result.url, topicContext, undefined, true)

          if (processed.relevance_score < 35) {
            log.discovery(`  Skipped (relevance ${processed.relevance_score}): ${result.url}`)
            continue
          }

          const finding: ResearchFinding = {
            url: result.url,
            title: result.title || fetched.title || "Untitled",
            snippet: result.snippet || "",
            summary: processed.bias_corrected_summary,
            relevance: processed.relevance_score,
          }
          queryFindings.push(finding)
          findings.push(finding)

          emitThink(topicId, "💡", `Found · ${result.title || fetched.title || domainOf(result.url)}`, `relevance ${processed.relevance_score}`)
          log.discovery(`  Finding stored (relevance ${processed.relevance_score}): ${result.url}`)
        } catch (e) {
          log.discovery(`  Fetch/process failed for ${result.url}: ${e}`)
        }
      }

      // Synthesize findings across sources for this query angle
      if (queryFindings.length >= 2) {
        const synthesis = await synthesizeFindings(queryFindings, query, topicContext, model)
        if (synthesis) {
          // Attach the multi-source synthesis to the first finding so formatFindings() picks it up
          queryFindings[0].multi_source_summary = synthesis
          log.discovery(`  Synthesized ${queryFindings.length} sources for query "${query}"`)
          emitThink(topicId, "🔗", `Synthesized · ${queryFindings.length} sources`, query)
        }
      }
    } catch (e) {
      log.discovery(`Search failed for "${query}": ${e}`)
    }
  }

  log.discovery(`Broad research complete: ${findings.length} findings in memory`)
  onProgress?.(`Discovery: collected ${findings.length} research findings`)
  emitThink(topicId, "📚", `${findings.length} findings collected`, "Identifying parties from evidence…")

  // ─────────────────────────────────────────────
  // STEP 3: Identify parties from research evidence
  // ─────────────────────────────────────────────
  onProgress?.("Discovery: identifying parties from evidence…")

  const researchSummary = formatFindings(findings, 50)
  const IDENTIFY_PROMPT = loadPrompt("discovery/identify-parties", {
    today,
    topic: title,
    research_summary: researchSummary,
  })
  const identifyInput = `TOPIC: ${title}\n\nDESCRIPTION: ${description}\n\nToday: ${today}`

  emitThink(topicId, "🧩", "Identifying parties from evidence", "Analyzing who is involved, who opposes whom…")

  const identifyBudget = budgetOutput(model, IDENTIFY_PROMPT + identifyInput, { min: 5000, max: 14000 })
  const rawParties = await parseWithRetry<Party[]>(
    async (hint) => chatCompletionText({
      model,
      messages: [
        { role: "system", content: IDENTIFY_PROMPT },
        { role: "user", content: identifyInput + (hint ? `\n\n${hint}` : "") },
      ],
      temperature: 0.3,
      max_tokens: identifyBudget,
    }),
    (raw) => {
      const match = raw.match(/\[[\s\S]+\]/)
      if (!match) throw new Error("No JSON array found")
      return JSON.parse(match[0]) as Party[]
    },
    (v) => Array.isArray(v) && v.length >= 1
  )

  const parties: Party[] = rawParties.map(p => ({
    ...p,
    id: p.id || slugify(p.name),
    auto_discovered: true,
    user_verified: false,
  }))

  log.discovery(`Identified ${parties.length} parties: ${parties.map(p => p.name).join(", ")}`)

  // Emit each party one by one with a small delay so user sees them appear
  for (const p of parties) {
    emitThink(topicId, "🧩", `Party · ${p.name}`, `${p.type.replace(/_/g, " ")} · weight ${p.weight}`)
    await new Promise(r => setTimeout(r, 150))
  }

  // ─────────────────────────────────────────────
  // STEP 4: Party-specific research — snippets only, fast, no DB writes
  // ─────────────────────────────────────────────
  onProgress?.(`Discovery: targeted research on ${parties.length} parties…`)

  for (const party of parties) {
    const queries = partyResearchQueries(party, title, year)
    if (queries.length === 0) {
      log.discovery(`Skipping party research for ${party.name} (type: ${party.type})`)
      continue
    }

    emitThink(topicId, "🔬", `Researching · ${party.name}`, queries[0])
    log.discovery(`Party research: ${party.name} — ${queries.length} queries`)
    allSearchQueries.push(...queries)

    for (const query of queries) {
      try {
        await new Promise(r => setTimeout(r, 400))
        const results = await webSearch(query, 3)
        for (const result of results.slice(0, 2)) {
          // Snippets only — no httpFetch, no processClue, no DB
          if (!result.snippet && !result.title) continue
          const finding: ResearchFinding = {
            url: result.url,
            title: result.title || "",
            snippet: result.snippet || "",
            summary: result.snippet || "",   // snippet serves as summary for party research
            relevance: 50,                    // unscored — used for context only
            party_hint: party.id,
          }
          findings.push(finding)
          emitThink(topicId, "💡", `Found · ${result.title || domainOf(result.url)}`, `${party.name}`)
          log.discovery(`  Party snippet: ${result.title} (${domainOf(result.url)})`)
        }
      } catch (e) {
        log.discovery(`  Search failed for "${query}": ${e}`)
      }
    }
  }

  // ─────────────────────────────────────────────
  // STEP 5: Enrich party profiles from party-specific research
  // ─────────────────────────────────────────────
  onProgress?.("Discovery: enriching party profiles from research…")

  const ENRICH_PROMPT_BASE = loadPrompt("discovery/enrich-from-research", {
    today,
    topic: title,
    party_name: "",
    party_type: "",
    current_profile: "",
    party_clues: "",
  })

  const BATCH = 3
  for (let i = 0; i < parties.length; i += BATCH) {
    const batch = parties.slice(i, i + BATCH)
    await Promise.all(batch.map(async (party) => {
      try {
        // Collect research findings tagged to this party
        const partyFindings = findings.filter(f => f.party_hint === party.id)
        if (partyFindings.length === 0) {
          log.discovery(`No targeted findings for ${party.name}, skipping enrich`)
          return
        }

        emitThink(topicId, "✍️", `Profiling · ${party.name}`, "Synthesizing means, circle, vulnerabilities…")
        log.discovery(`Enriching profile: ${party.name} from ${partyFindings.length} findings`)

        const partyFindingsSummary = partyFindings
          .slice(0, 8)
          .map(f => `- ${f.title}: ${f.summary.slice(0, 250)}`)
          .join("\n")

        const currentProfile = JSON.stringify({
          description: party.description,
          agenda: party.agenda,
          means: party.means,
          circle: party.circle,
          vulnerabilities: party.vulnerabilities,
          stance: party.stance,
        }, null, 2)

        const ENRICH_PROMPT = loadPrompt("discovery/enrich-from-research", {
          today,
          topic: title,
          party_name: party.name,
          party_type: party.type,
          current_profile: currentProfile,
          party_clues: partyFindingsSummary,
        })

        const enrichInput = `Enrich the profile for ${party.name} based on the research findings provided.`
        const enrichBudget = budgetOutput(model, ENRICH_PROMPT + enrichInput, { min: 500, max: 1200 })

        const raw = await chatCompletionText({
          model,
          messages: [
            { role: "system", content: ENRICH_PROMPT },
            { role: "user", content: enrichInput },
          ],
          temperature: 0.2,
          max_tokens: enrichBudget,
        })

        const match = raw.match(/\{[\s\S]+\}/)
        if (match) {
          const enriched = JSON.parse(match[0])
          Object.assign(party, enriched)
          log.discovery(`  Enriched ${party.name}: means=${enriched.means?.length ?? 0}, circle.visible=${enriched.circle?.visible?.length ?? 0}`)
        }
      } catch (e) {
        log.discovery(`  Enrich failed for ${party.name}: ${e}`)
      }
    }))
  }

  // Suppress unused variable warning — ENRICH_PROMPT_BASE used to warm cache
  void ENRICH_PROMPT_BASE

  // ─────────────────────────────────────────────
  // STEP 5b: Auto party refinement — merge duplicates, delete unsupported, add emerged actors
  // ─────────────────────────────────────────────
  onProgress?.("Discovery: refining party list from research evidence…")
  emitThink(topicId, "🔀", "Refining party list", "Checking for merges, deletions, and new actors…")

  try {
    const partyListSummary = parties.map(p =>
      `${p.id} | ${p.name} (${p.type}) — ${p.agenda.slice(0, 120)}`
    ).join("\n")

    const researchSummaryForRefine = formatFindings(
      findings.filter(f => !f.party_hint),  // broad research only — less noisy
      40
    )

    const REFINE_PROMPT = loadPrompt("discovery/refine-parties", {
      today,
      topic: title,
      party_list: partyListSummary,
      research_summary: researchSummaryForRefine,
    })

    const refineBudget = budgetOutput(model, REFINE_PROMPT, { min: 500, max: 1500 })
    const refineRaw = await chatCompletionText({
      model,
      messages: [
        { role: "system", content: REFINE_PROMPT },
        { role: "user", content: "Analyze the party list against the research findings and output your consolidation decisions." },
      ],
      temperature: 0.2,
      max_tokens: refineBudget,
    })

    const refineMatch = refineRaw.match(/\{[\s\S]+\}/)
    if (refineMatch) {
      const decisions = JSON.parse(refineMatch[0]) as {
        merge: { source_ids: string[]; into: string; reason: string }[]
        delete: { id: string; reason: string }[]
        add: { name: string; type: Party["type"]; reason: string }[]
      }

      // Apply deletes first
      for (const del of (decisions.delete ?? [])) {
        const idx = parties.findIndex(p => p.id === del.id)
        if (idx !== -1) {
          emitThink(topicId, "🗑️", `Removing · ${parties[idx].name}`, del.reason)
          log.discovery(`  Removing party "${parties[idx].name}": ${del.reason}`)
          parties.splice(idx, 1)
        }
      }

      // Apply merges in-memory
      for (const merge of (decisions.merge ?? [])) {
        const sources = merge.source_ids.map(id => parties.find(p => p.id === id)).filter(Boolean) as Party[]
        if (sources.length < 2) continue

        const mergedId = slugify(merge.into)
        // Synthesize merged profile from sources
        const merged: Party = {
          id: mergedId,
          name: merge.into,
          type: sources[0].type,
          description: sources.map(s => s.description).join(" "),
          weight: Math.round(sources.reduce((s, p) => s + p.weight, 0) / sources.length),
          weight_factors: sources[0].weight_factors,
          agenda: sources.map(s => s.agenda).filter(Boolean).join("; "),
          means: [...new Set(sources.flatMap(s => s.means))],
          circle: {
            visible: [...new Set(sources.flatMap(s => s.circle?.visible ?? []))],
            shadow: [...new Set(sources.flatMap(s => s.circle?.shadow ?? []))],
          },
          stance: sources[0].stance,
          vulnerabilities: [...new Set(sources.flatMap(s => s.vulnerabilities))],
          auto_discovered: true,
          user_verified: false,
        }

        // Remove sources, add merged
        for (const src of sources) {
          const idx = parties.findIndex(p => p.id === src.id)
          if (idx !== -1) parties.splice(idx, 1)
        }
        parties.push(merged)

        emitThink(topicId, "🔀", `Merging · ${sources.map(s => s.name).join(" + ")} → ${merge.into}`, merge.reason)
        log.discovery(`  Merged [${merge.source_ids.join(", ")}] → "${merge.into}": ${merge.reason}`)
      }

      // Apply adds
      for (const add of (decisions.add ?? [])) {
        // Don't add if a party with this name already exists
        const exists = parties.find(p => p.name.toLowerCase() === add.name.toLowerCase())
        if (exists) continue

        const stub: Party = {
          id: slugify(add.name),
          name: add.name,
          type: add.type ?? "non_state",
          description: add.reason,
          weight: 30,
          weight_factors: { military_capacity: 0, economic_control: 0, information_control: 0, international_support: 0, internal_legitimacy: 0 },
          agenda: add.reason,
          means: [],
          circle: { visible: [], shadow: [] },
          stance: "active",
          vulnerabilities: [],
          auto_discovered: true,
          user_verified: false,
        }
        parties.push(stub)

        emitThink(topicId, "➕", `Adding · ${add.name}`, add.reason)
        log.discovery(`  Added party "${add.name}": ${add.reason}`)
      }

      log.discovery(`Party refinement complete: ${parties.length} parties after refinement`)
    }
  } catch (e) {
    log.discovery(`Party refinement failed (non-fatal): ${e}`)
  }

  // ─────────────────────────────────────────────
  // STEP 6: Save parties to DB (no clues — that's Enrichment's job)
  // ─────────────────────────────────────────────
  emitThink(topicId, "💾", `Saving ${parties.length} parties`, `${findings.length} research findings collected`)
  log.discovery(`Saving ${parties.length} parties to DB (no clues stored — reserved for Enrichment)`)

  dbSetParties(topicId, parties)
  onProgress?.(`Discovery: complete — ${parties.length} parties identified`)

  const output: DiscoveryOutput = {
    topic_id: topicId,
    parties,
    research_findings: findings,
    search_queries: [...new Set(allSearchQueries)],
    run_id: runId,
  }

  await writeArtifact(topicId, runId, "discovery_output", output)
  return output
}
