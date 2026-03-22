import { chatCompletionText } from "../llm/proxyClient"
import { budgetOutput } from "../llm/tokenBudget"
import { webSearch } from "../tools/external/webSearch"
import { httpFetch } from "../tools/external/httpFetch"
import { log } from "../utils/logger"
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
      const results = await webSearch(query, 3)
      for (const r of results.slice(0, 2)) {
        try {
          const fetched = await httpFetch(r.url, topicId)
          snippets.push(`[${r.title}]\n${fetched.raw_content.slice(0, 2000)}`)
        } catch {
          if (r.snippet) snippets.push(`[${r.title}] ${r.snippet}`)
        }
      }
    } catch { /* skip */ }
  }
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
          content: `You are an intelligence analyst extracting structured factual claims from a mixed-format intelligence brief containing narrative text, dated updates, source links, and analysis.

Extract every distinct factual event, statement, or development as a separate clue. Be thorough — this is raw intelligence material and every fact matters.

KNOWN PARTIES (use these IDs in party_relevance):
${partyList}

Output ONLY a valid JSON array:
[{
  "title": "<concise factual title>",
  "summary": "<bias-corrected factual summary, 1-3 sentences>",
  "date": "<YYYY-MM-DD or 'unknown'>",
  "relevance": <50-100>,
  "credibility": <0-100, based on source quality>,
  "parties": ["<party_id>", ...],
  "source_url": "<URL if mentioned, else empty>",
  "source_outlet": "<source name: IDF, Reuters, CENTCOM, Trump, Netanyahu, etc.>",
  "bias_flags": ["<flag if applicable>"],
  "clue_type": "<event|statement|military_action|intelligence|economic|diplomatic>",
  "domain_tags": ["<military|nuclear|economic|political|social|intelligence>"],
  "key_points": ["<key fact 1>", "<key fact 2>"]
}]

Rules:
- Each clue = one distinct fact/event/statement. Do NOT merge multiple events.
- Attribute to the actual speaker/source (e.g., "Netanyahu stated..." not just "Israel")
- For military strikes: include location, target type, and claimed results
- For statements: quote key phrases and attribute precisely
- Use party IDs from the list above, create new slugs only if no match
- Credibility: official military/govt sources=70-85, verified journalists=60-75, unconfirmed/OSINT=40-55
- bias_flags: state_media, propaganda, unverified, osint, official_statement, opposition_media
- Extract as many clues as the content warrants. No maximum limit.
- Output ONLY valid JSON array. No markdown fences.`,
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
      const match = raw.match(/\[[\s\S]+\]/)
      if (!match) {
        log.error("SMART_EXTRACT", `No JSON array in chunk ${i + 1} response`)
        continue
      }
      const extracted = JSON.parse(match[0]) as ExtractedClue[]
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

  // Research based on feedback
  const research = await gatherResearch([
    `${currentClue.title} ${feedback.slice(0, 60)}`,
    `${topicTitle} ${feedback.slice(0, 80)}`,
  ], topicId)

  const raw = await chatCompletionText({
    model,
    messages: [
      {
        role: "system",
        content: `You are an intelligence analyst updating a clue/evidence item based on user feedback and research.

Output ONLY a valid JSON object:
{
  "title": "<updated title>",
  "summary": "<updated bias-corrected summary>",
  "credibility": <0-100>,
  "bias_flags": ["<flag>"],
  "relevance": <0-100>,
  "parties": ["<party_id>"],
  "date": "<YYYY-MM-DD>",
  "clue_type": "<event|statement|military_action|intelligence|economic|diplomatic>",
  "domain_tags": ["<tag>"]
}

Preserve accurate information. Only change what the feedback and research warrant. Be specific and fact-based.`,
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
        content: `You generate targeted web search queries to investigate a specific research direction for geopolitical analysis. Output ONLY a JSON array of 3-5 search query strings. No markdown.`,
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
        content: `You are an intelligence analyst extracting structured factual claims from research material gathered to investigate a specific question.

KNOWN PARTIES (use these IDs in party relevance):
${partyList}

Output ONLY a valid JSON array of clues:
[{
  "title": "<concise factual title>",
  "summary": "<bias-corrected factual summary, 1-3 sentences>",
  "date": "<YYYY-MM-DD or 'unknown'>",
  "relevance": <50-100>,
  "credibility": <0-100>,
  "parties": ["<party_id>"],
  "source_url": "<URL if available>",
  "source_outlet": "<source name>",
  "bias_flags": ["<flag if applicable>"],
  "clue_type": "<event|statement|military_action|intelligence|economic|diplomatic>",
  "domain_tags": ["<tag>"],
  "key_points": ["<key fact>"]
}]

Rules:
- Extract every distinct verifiable fact relevant to the research question
- Each clue = one fact/event/statement
- Attribute sources precisely
- Be thorough — the user asked to research this specific direction
- Output ONLY valid JSON array`,
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
