import { chatCompletionText } from "../llm/proxyClient"
import { budgetOutput } from "../llm/tokenBudget"
import { loadPrompt } from "../llm/promptLoader"
import { webSearch } from "../tools/external/webSearch"
import { httpFetch } from "../tools/external/httpFetch"
import { log } from "../utils/logger"
import { emitThink } from "../routes/stream"
import type { Party } from "./DiscoveryAgent"

export interface ExtractedClue {
  title: string
  summary: string
  date: string
  relevance: number
  credibility: number
  parties: string[]
  source_url: string
  source_outlet: string
  bias_flags: string[]
  clue_type: string
  domain_tags: string[]
  key_points: string[]
}

// Extract all URLs from mixed text
function extractUrls(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s<>")\]]+/g
  const matches = text.match(urlRegex) || []
  return [...new Set(matches)]
}

// Chunk text into segments that fit in LLM context
function chunkText(text: string, maxChars: number = 12000): string[] {
  if (text.length <= maxChars) return [text]
  const chunks: string[] = []
  const sections = text.split(/\n(?=[\*#\-]|\d{4}|[A-Z])/g)

  let current = ""
  for (const section of sections) {
    if (current.length + section.length > maxChars && current.length > 0) {
      chunks.push(current)
      current = section
    } else {
      current += (current ? "\n" : "") + section
    }
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

async function gatherResearch(queries: string[], topicId: string): Promise<string> {
  const snippets: string[] = []
  for (const query of queries.slice(0, 3)) {
    try {
      await new Promise(r => setTimeout(r, 400))
      emitThink(topicId, "🔎", "Searching", query)
      log.enrichment(`Research query: "${query}"`)
      const results = await webSearch(query, 3)
      log.enrichment(`Research: "${query}" → ${results.length} results`)
      emitThink(topicId, "📄", `Found ${results.length} results`, results.slice(0, 3).map(r => r.title).join(", "))
      for (const r of results.slice(0, 2)) {
        try {
          emitThink(topicId, "🌐", "Fetching", r.title)
          const fetched = await httpFetch(r.url, topicId)
          snippets.push(`[${r.title}]\n${fetched.raw_content.slice(0, 2000)}`)
          emitThink(topicId, "✓", "Fetched", `${r.title} (${fetched.raw_content.length} chars)`)
        } catch (fetchErr) {
          log.enrichment(`Research fetch failed for ${r.url}: ${fetchErr instanceof Error ? fetchErr.message : fetchErr}`)
          if (r.snippet) snippets.push(`[${r.title}] ${r.snippet}`)
        }
      }
    } catch (searchErr) {
      log.enrichment(`Research search failed for "${query}": ${searchErr instanceof Error ? searchErr.message : searchErr}`)
      emitThink(topicId, "⚠", "Search failed", searchErr instanceof Error ? searchErr.message : String(searchErr))
    }
  }
  log.enrichment(`Research complete: ${snippets.length} snippets, ${snippets.join("").length} chars`)
  emitThink(topicId, "📊", "Research complete", `${snippets.length} snippets gathered`)
  return snippets.join("\n\n---\n\n").slice(0, 12000)
}

// Fetch URLs that are likely to succeed (skip social media that needs auth)
function isFetchable(url: string): boolean {
  const skip = ["x.com", "twitter.com", "instagram.com", "facebook.com", "truthsocial.com", "t.me"]
  try {
    const host = new URL(url).hostname
    return !skip.some(s => host.includes(s))
  } catch { return false }
}

export async function smartExtractClues(
  topicId: string,
  topicTitle: string,
  topicDescription: string,
  content: string,
  parties: Party[],
  model: string,
  onProgress?: (msg: string) => void,
): Promise<ExtractedClue[]> {
  const topicContext = `${topicTitle}: ${topicDescription}`
  const partyList = parties.map(p => `${p.id}: ${p.name}`).join("\n")

  // Step 1: Extract and fetch URLs from the text
  const urls = extractUrls(content)
  log.enrichment(`Smart extract: found ${urls.length} URLs in content`)
  onProgress?.(`Found ${urls.length} URLs, fetching accessible ones...`)

  const fetchableUrls = urls.filter(isFetchable)
  const fetchedContent: Record<string, string> = {}
  let fetched = 0

  for (const url of fetchableUrls.slice(0, 15)) {
    try {
      const result = await httpFetch(url, topicId)
      if (result.raw_content.length > 100) {
        fetchedContent[url] = result.raw_content.slice(0, 3000)
        fetched++
      }
    } catch { /* skip */ }
  }

  log.enrichment(`Smart extract: fetched ${fetched}/${fetchableUrls.length} URLs`)
  onProgress?.(`Fetched ${fetched} sources, extracting clues...`)

  // Step 2: Build enriched content with fetched material appended
  let enrichedContent = content
  if (Object.keys(fetchedContent).length > 0) {
    enrichedContent += "\n\n--- FETCHED SOURCE CONTENT ---\n"
    for (const [url, text] of Object.entries(fetchedContent)) {
      enrichedContent += `\n[SOURCE: ${url}]\n${text}\n`
    }
  }

  // Step 3: Chunk and extract clues from each chunk
  const chunks = chunkText(enrichedContent, 14000)
  log.enrichment(`Smart extract: processing ${chunks.length} chunk(s)`)

  const allClues: ExtractedClue[] = []

  for (let i = 0; i < chunks.length; i++) {
    onProgress?.(`Extracting clues from chunk ${i + 1}/${chunks.length}...`)

    const raw = await chatCompletionText({
      model,
      messages: [
        {
          role: "system",
          content: loadPrompt("clue-extractor/extract", { party_list: partyList }),
        },
        {
          role: "user",
          content: `TOPIC: ${topicContext}

INTELLIGENCE BRIEF (chunk ${i + 1}/${chunks.length}):
${chunks[i]}`,
        },
      ],
      temperature: 0.2,
      max_tokens: budgetOutput(model, topicContext + chunks[i], { min: 4000, max: 10000 }),
    })

    try {
      const match = raw.match(/\[[\s\S]+/)
      if (!match) {
        log.error("SMART_EXTRACT", `No JSON array in chunk ${i + 1} response`)
        continue
      }
      let jsonStr = match[0]
      let extracted: ExtractedClue[]
      try {
        extracted = JSON.parse(jsonStr)
      } catch {
        // Truncated JSON — salvage complete objects by finding last complete }, then close the array
        const lastComplete = jsonStr.lastIndexOf("},")
        const lastObj = jsonStr.lastIndexOf("}")
        const cutPoint = lastComplete > 0 ? lastComplete + 1 : lastObj > 0 ? lastObj + 1 : -1
        if (cutPoint > 0) {
          const salvaged = jsonStr.slice(0, cutPoint) + "]"
          try {
            extracted = JSON.parse(salvaged)
            log.enrichment(`Chunk ${i + 1}: salvaged ${extracted.length} clues from truncated JSON`)
          } catch {
            log.error("SMART_EXTRACT", `Parse error chunk ${i + 1} (salvage failed)`)
            continue
          }
        } else {
          log.error("SMART_EXTRACT", `Parse error chunk ${i + 1} (no salvageable objects)`)
          continue
        }
      }
      allClues.push(...extracted)
      log.enrichment(`Chunk ${i + 1}: extracted ${extracted.length} clues`)
    } catch (e) {
      log.error("SMART_EXTRACT", `Parse error chunk ${i + 1}`, e)
    }
  }

  // Step 4: Deduplicate by title similarity
  const seen = new Set<string>()
  const deduped = allClues.filter(c => {
    const key = c.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 50)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  log.enrichment(`Smart extract complete: ${deduped.length} unique clues from ${allClues.length} total`)
  onProgress?.(`Extracted ${deduped.length} clues`)
  return deduped
}

// Smart edit a single clue based on user feedback
export async function smartEditClue(
  topicId: string,
  topicTitle: string,
  currentClue: {
    title: string
    summary: string
    credibility: number
    bias_flags: string[]
    relevance: number
    parties: string[]
    source_url: string
    source_outlet: string
    date: string
    clue_type: string
  },
  feedback: string,
  model: string,
): Promise<{
  title: string
  summary: string
  credibility: number
  bias_flags: string[]
  relevance: number
  parties: string[]
  date: string
  clue_type: string
  domain_tags: string[]
}> {
  log.enrichment(`Smart clue edit: researching feedback for "${currentClue.title}"`)
  emitThink(topicId, "📝", "Smart edit started", `Editing "${currentClue.title}" — ${feedback.slice(0, 80)}`)

  // Research based on feedback
  const research = await gatherResearch([
    `${currentClue.title} ${feedback.slice(0, 60)}`,
    `${topicTitle} ${feedback.slice(0, 80)}`,
  ], topicId)

  emitThink(topicId, "🤖", "Applying edits", `Sending to ${model} with research context`)
  const raw = await chatCompletionText({
    model,
    messages: [
      {
        role: "system",
        content: loadPrompt("clue-extractor/edit"),
      },
      {
        role: "user",
        content: `TOPIC: ${topicTitle}

CURRENT CLUE:
${JSON.stringify(currentClue, null, 2)}

USER FEEDBACK:
${feedback}

RESEARCH:
${research}

Update the clue. Output ONLY valid JSON.`,
      },
    ],
    temperature: 0.2,
    max_tokens: budgetOutput(model, topicTitle + JSON.stringify(currentClue) + feedback + research, { min: 1000, max: 3000 }),
  })

  const match = raw.match(/\{[\s\S]+\}/)
  if (!match) throw new Error("Failed to parse clue JSON from LLM response")
  const updated = JSON.parse(match[0])

  log.enrichment(`Smart clue edit complete: "${updated.title}"`)
  emitThink(topicId, "✅", "Smart edit complete", `Updated: "${updated.title}"`)
  return updated
}

// Research a direction/question and extract clues from findings
export async function researchAndExtractClues(
  topicId: string,
  topicTitle: string,
  topicDescription: string,
  query: string,
  parties: Party[],
  model: string,
): Promise<ExtractedClue[]> {
  const partyList = parties.map(p => `${p.id}: ${p.name}`).join("\n")

  log.enrichment(`Research: generating search queries for "${query.slice(0, 80)}"`)

  // Step 1: LLM generates targeted search queries from the user's research direction
  const queriesRaw = await chatCompletionText({
    model,
    messages: [
      {
        role: "system",
        content: loadPrompt("clue-extractor/queries"),
      },
      {
        role: "user",
        content: `TOPIC: ${topicTitle}
RESEARCH DIRECTION: ${query}

Generate 3-5 specific, fact-finding search queries that would uncover concrete evidence, events, statements, or data related to this research direction. Focus on recent news and verifiable facts.`,
      },
    ],
    temperature: 0.3,
    max_tokens: 500,
  })

  let searchQueries: string[] = []
  try {
    const match = queriesRaw.match(/\[[\s\S]+\]/)
    if (match) searchQueries = JSON.parse(match[0])
  } catch { /* fallback */ }
  if (searchQueries.length === 0) {
    searchQueries = [query, `${query} ${topicTitle} ${new Date().getFullYear()}`]
  }

  log.enrichment(`Research: ${searchQueries.length} search queries: ${searchQueries.join(" | ")}`)

  // Step 2: Search and fetch (limited to avoid memory/timeout issues)
  const fetchedContent: string[] = []
  for (const sq of searchQueries.slice(0, 4)) {
    try {
      const results = await webSearch(sq, 3)
      for (const r of results.slice(0, 2)) {
        try {
          if (!isFetchable(r.url)) {
            if (r.snippet) fetchedContent.push(`[${r.title}] (${r.url})\n${r.snippet}`)
            continue
          }
          const fetched = await httpFetch(r.url, topicId)
          fetchedContent.push(`[${r.title}] (${r.url})\n${fetched.raw_content.slice(0, 2000)}`)
        } catch {
          if (r.snippet) fetchedContent.push(`[${r.title}] (${r.url})\n${r.snippet}`)
        }
      }
    } catch { /* skip */ }
  }

  log.enrichment(`Research: fetched ${fetchedContent.length} source fragments`)

  if (fetchedContent.length === 0) {
    log.enrichment("Research: no sources found, returning empty")
    return []
  }

  // Step 3: Extract clues from research findings
  const combinedResearch = fetchedContent.join("\n\n---\n\n").slice(0, 12000)

  const raw = await chatCompletionText({
    model,
    messages: [
      {
        role: "system",
        content: loadPrompt("clue-extractor/research", { party_list: partyList }),
      },
      {
        role: "user",
        content: `TOPIC: ${topicTitle}: ${topicDescription}

RESEARCH QUESTION: ${query}

GATHERED SOURCES:
${combinedResearch}

Extract all relevant factual claims as structured clues.`,
      },
    ],
    temperature: 0.2,
    max_tokens: budgetOutput(model, partyList + combinedResearch + query, { min: 4000, max: 10000 }),
  })

  try {
    const match = raw.match(/\[[\s\S]+\]/)
    if (!match) throw new Error("No JSON array")
    const clues = JSON.parse(match[0]) as ExtractedClue[]
    log.enrichment(`Research: extracted ${clues.length} clues for "${query.slice(0, 50)}"`)
    return clues
  } catch (e) {
    log.error("RESEARCH", "Failed to parse extracted clues", e)
    return []
  }
}

// Categorize and propose cleanup groups
export interface ClueGroup {
  group_id: string
  category: string
  merged_title: string
  merged_summary: string
  merged_credibility: number
  merged_bias_flags: string[]
  merged_relevance: number
  merged_date: string
  merged_clue_type: string
  merged_domain_tags: string[]
  merged_parties: string[]
  source_clue_ids: string[]
  action: "merge" | "keep" | "delete"
  reason: string
}

export async function categorizeAndCleanup(
  topicId: string,
  topicTitle: string,
  clues: { id: string; title: string; summary: string; date: string; credibility: number; relevance: number; parties: string[]; clue_type: string; bias_flags: string[]; domain_tags: string[] }[],
  parties: { id: string; name: string }[],
  model: string,
): Promise<ClueGroup[]> {
  const partyList = parties.map(p => `${p.id}: ${p.name}`).join("\n")

  log.enrichment(`Cleanup: categorizing ${clues.length} clues`)

  // Build a compact clue list for the LLM
  const clueList = clues.map(c =>
    `[${c.id}] "${c.title}" (${c.date}, cred=${c.credibility}, rel=${c.relevance}, type=${c.clue_type}, parties=[${c.parties.join(",")}]) — ${c.summary.slice(0, 150)}`
  ).join("\n")

  // May need to chunk if too large
  const inputSize = clueList.length + partyList.length + 2000
  const maxInput = 60000 // chars, ~17k tokens
  let clueInput = clueList
  if (inputSize > maxInput) {
    // Truncate summaries more aggressively
    clueInput = clues.map(c =>
      `[${c.id}] "${c.title}" (${c.date}, cred=${c.credibility}, type=${c.clue_type}) — ${c.summary.slice(0, 60)}`
    ).join("\n")
  }

  const raw = await chatCompletionText({
    model,
    messages: [
      {
        role: "system",
        content: loadPrompt("clue-extractor/categorize", { party_list: partyList }),
      },
      {
        role: "user",
        content: `TOPIC: ${topicTitle}

CLUES TO ORGANIZE (${clues.length} total):
${clueInput}

Categorize and group these clues. Every clue ID must appear in exactly one group.`,
      },
    ],
    temperature: 0.2,
    max_tokens: budgetOutput(model, clueInput + partyList, { min: 8000, max: 16000 }),
  })

  try {
    const match = raw.match(/\[[\s\S]+/)
    if (!match) throw new Error("No JSON array")
    let jsonStr = match[0]
    let groups: ClueGroup[]
    try {
      groups = JSON.parse(jsonStr)
    } catch {
      // Truncated JSON — salvage complete group objects
      const lastComplete = jsonStr.lastIndexOf("},")
      const lastObj = jsonStr.lastIndexOf("}")
      const cutPoint = lastComplete > 0 ? lastComplete + 1 : lastObj > 0 ? lastObj + 1 : -1
      if (cutPoint > 0) {
        const salvaged = jsonStr.slice(0, cutPoint) + "]"
        groups = JSON.parse(salvaged)
        log.enrichment(`Cleanup: salvaged ${groups.length} groups from truncated JSON`)
      } else {
        throw new Error("No salvageable groups in truncated JSON")
      }
    }
    log.enrichment(`Cleanup: ${groups.length} groups proposed (${groups.filter(g => g.action === "merge").length} merge, ${groups.filter(g => g.action === "keep").length} keep, ${groups.filter(g => g.action === "delete").length} delete)`)
    return groups
  } catch (e) {
    log.error("CLEANUP", "Failed to parse cleanup groups", e)
    throw new Error("Failed to categorize clues")
  }
}
