import { chatCompletionText } from "../llm/proxyClient"
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
      max_tokens: 8000,
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
