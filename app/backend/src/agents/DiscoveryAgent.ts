import { chatCompletionText } from "../llm/proxyClient"
import { budgetOutput } from "../llm/tokenBudget"
import { webSearch } from "../tools/external/webSearch"
import { httpFetch } from "../tools/external/httpFetch"
import { processClue } from "../tools/processing/clueProcessor"
import { storeClue } from "../tools/processing/storeClue"
import { log } from "../utils/logger"
import { join } from "path"

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

export interface DiscoveryOutput {
  topic_id: string
  parties: Party[]
  seed_clue_ids: string[]
  search_queries: string[]
  run_id: string
}

const PARTIES_SYSTEM = `You are a geopolitical intelligence analyst performing initial topic discovery.

Given a topic, identify all materially involved parties (minimum 5, aim for 8).

Output ONLY a valid JSON array of party objects:
[
  {
    "id": "<slug e.g. irgc>",
    "name": "<full name>",
    "type": "<state|state_military|non_state|individual|media|economic|alliance>",
    "description": "<1-2 sentence description>",
    "weight": <0-100>,
    "weight_factors": {"military_capacity":<0-100>,"economic_control":<0-100>,"information_control":<0-100>,"international_support":<0-100>,"internal_legitimacy":<0-100>},
    "agenda": "<their goal regarding this topic>",
    "means": ["<lever of power>"],
    "circle": {"visible": ["<known ally>"], "shadow": ["<inferred actor>"]},
    "stance": "<active|passive|covert|overt|defensive_active>",
    "vulnerabilities": ["<weak point>"],
    "auto_discovered": true,
    "user_verified": false
  }
]

Output ONLY the JSON array, no prose, no markdown fences, no trailing commas.`

const QUERIES_SYSTEM = `Given a topic and a list of involved parties, generate 6 targeted web search queries to find recent relevant news and events.

Output ONLY a valid JSON array of strings:
["query 1", "query 2", "query 3", "query 4", "query 5", "query 6"]

Queries should be specific, recent-news-focused, and cover different angles of the topic.
Output ONLY the JSON array, no prose.`

async function parseWithRetry<T>(
  call: (hint?: string) => Promise<string>,
  parse: (raw: string) => T,
  validate: (v: T) => boolean,
  maxAttempts = 3
): Promise<T> {
  let lastError = ""
  for (let i = 0; i < maxAttempts; i++) {
    const hint = i > 0 ? `Previous attempt failed: ${lastError}. Output ONLY valid JSON. No trailing commas. No markdown.` : undefined
    const raw = await call(hint)
    try {
      const v = parse(raw)
      if (!validate(v)) throw new Error("Validation failed")
      return v
    } catch (e) {
      lastError = String(e)
      console.warn(`parseWithRetry attempt ${i + 1} failed:`, lastError)
    }
  }
  throw new Error(`Failed after ${maxAttempts} attempts: ${lastError}`)
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30)
}

function getDataDir(): string {
  return process.env.DATA_DIR || "/home/nima/dana/data"
}

async function writeArtifact(runId: string, topicId: string, name: string, data: unknown): Promise<void> {
  const dir = join(getDataDir(), "topics", topicId, "logs", `run-${runId}`)
  const { mkdir } = await import("fs/promises")
  await mkdir(dir, { recursive: true })
  await Bun.write(join(dir, `${name}.json`), JSON.stringify(data, null, 2))
}

async function writeJSON(path: string, data: unknown): Promise<void> {
  await Bun.write(path, JSON.stringify(data, null, 2))
}

export async function runDiscoveryAgent(
  topicId: string,
  title: string,
  description: string,
  model: string,
  runId: string,
  onProgress?: (msg: string) => void
): Promise<DiscoveryOutput> {
  log.discovery(`Analyzing topic: "${title}"`)
  onProgress?.(`Discovery: analyzing topic "${title}"`)

  // Step 1: LLM identifies parties and search queries
  const prompt = `TOPIC: ${title}\n\nDESCRIPTION: ${description}\n\nIdentify all involved parties and generate search queries.`

  // Step A: get parties (array output — smaller, less likely to truncate)
  const discoveryOutputBudget = budgetOutput(model, PARTIES_SYSTEM + prompt, { min: 4000, max: 10000 })
  const parties = await parseWithRetry<Party[]>(
    async (hint) => chatCompletionText({
      model,
      messages: [
        { role: "system", content: PARTIES_SYSTEM },
        { role: "user", content: prompt + (hint ? `\n\n${hint}` : "") },
      ],
      temperature: 0.3,
      max_tokens: discoveryOutputBudget,
    }),
    (raw) => {
      const match = raw.match(/\[[\s\S]+\]/)
      if (!match) throw new Error("No JSON array found")
      return JSON.parse(match[0]) as Party[]
    },
    (v) => Array.isArray(v) && v.length >= 5
  )

  // Step B: get search queries (simple string array)
  const partyNames = parties.map(p => p.name).join(", ")
  const queriesPrompt = `TOPIC: ${title}\nPARTIES: ${partyNames}`
  const searchQueries = await parseWithRetry<string[]>(
    async (hint) => chatCompletionText({
      model,
      messages: [
        { role: "system", content: QUERIES_SYSTEM },
        { role: "user", content: queriesPrompt + (hint ? `\n\n${hint}` : "") },
      ],
      temperature: 0.3,
      max_tokens: 500,
    }),
    (raw) => {
      const match = raw.match(/\[[\s\S]+\]/)
      if (!match) throw new Error("No JSON array found")
      return JSON.parse(match[0]) as string[]
    },
    (v) => Array.isArray(v) && v.length >= 3
  )

  const parsed = { parties, search_queries: searchQueries }

  if (!parsed.parties || parsed.parties.length < 5) {
    throw new Error(`DiscoveryAgent: expected ≥5 parties, got ${parsed.parties?.length ?? 0}`)
  }

  // Ensure IDs are unique slugs
  const normalizedParties: Party[] = parsed.parties.map(p => ({
    ...p,
    id: p.id || slugify(p.name),
  }))

  log.discovery(`Found ${normalizedParties.length} parties: ${normalizedParties.map(p => `${p.name} (w=${p.weight})`).join(", ")}`)
  log.discovery(`Generated ${parsed.search_queries.length} search queries`)
  onProgress?.(`Discovery: found ${normalizedParties.length} parties, running ${parsed.search_queries.length} searches`)

  // Step 2: Run searches and seed clues
  const seedClueIds: string[] = []
  const topicContext = `${title}: ${description}`

  for (const query of parsed.search_queries.slice(0, 6)) {
    try {
      onProgress?.(`Discovery: searching "${query}"`)
      const results = await webSearch(query, 3)

      for (const result of results.slice(0, 2)) {
        try {
          const fetched = await httpFetch(result.url, topicId)
          const processed = await processClue(fetched.raw_content, result.url, topicContext)

          if (processed.relevance_score < 40) continue

          const stored = await storeClue({
            topicId,
            title: result.title || fetched.title,
            sourceUrl: result.url,
            fetchedAt: fetched.fetched_at,
            processed,
            addedBy: "auto",
          })

          if (stored.status === "created") {
            seedClueIds.push(stored.clue_id)
          }
        } catch {
          // skip individual fetch/process failures
        }
      }
    } catch {
      // skip individual search failures
    }
  }

  onProgress?.(`Discovery: seeded ${seedClueIds.length} clues`)

  // Step 3: Write parties.json
  const partiesPath = join(getDataDir(), "topics", topicId, "parties.json")
  await writeJSON(partiesPath, normalizedParties)

  // Step 4: Write artifact
  const output: DiscoveryOutput = {
    topic_id: topicId,
    parties: normalizedParties,
    seed_clue_ids: seedClueIds,
    search_queries: parsed.search_queries,
    run_id: runId,
  }
  await writeArtifact(runId, topicId, "discovery_output", output)

  return output
}
