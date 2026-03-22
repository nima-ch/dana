import { getClueIndex } from "../tools/internal/getClue"
import { getPartyIndex } from "../tools/internal/getPartyProfile"
import { join } from "path"

function getDataDir() { return process.env.DATA_DIR || "/home/nima/dana/data" }

export type AgentType = "discovery" | "enrichment" | "weight" | "forum" | "expert" | "verdict" | "delta"

export interface AgentContextSnapshot {
  current_version: number
  party_index: { id: string; name: string; weight: number }[]
  clue_index: { id: string; title: string; timeline_date: string; party_relevance: string[]; relevance_score: number }[]
  forum_summary?: string
  prior_verdict_summary?: string
}

async function getTopicVersion(topicId: string): Promise<number> {
  const path = join(getDataDir(), "topics", topicId, "topic.json")
  const file = Bun.file(path)
  if (!(await file.exists())) return 0
  const topic = await file.json() as { current_version: number }
  return topic.current_version
}

async function getForumSummary(topicId: string): Promise<string | undefined> {
  // Try to get the latest forum session's condensed summary from states.json
  const statesPath = join(getDataDir(), "topics", topicId, "states.json")
  const file = Bun.file(statesPath)
  if (!(await file.exists())) return undefined
  const states = await file.json() as { version: number; forum_session_id?: string }[]
  if (!states.length) return undefined

  const latest = states[states.length - 1]
  if (!latest.forum_session_id) return undefined

  const sessionPath = join(getDataDir(), "topics", topicId, `${latest.forum_session_id}.json`)
  const sessionFile = Bun.file(sessionPath)
  if (!(await sessionFile.exists())) return undefined

  const session = await sessionFile.json() as { scenario_summary?: { scenarios: { title: string; id: string }[] } }
  if (!session.scenario_summary?.scenarios?.length) return undefined

  // Condensed: just scenario titles — ~10 tokens each
  const titles = session.scenario_summary.scenarios.map((s, i) => `${i + 1}. ${s.title}`).join("; ")
  return `Forum produced ${session.scenario_summary.scenarios.length} scenarios: ${titles}`
}

async function getVerdictSummary(topicId: string): Promise<string | undefined> {
  const statesPath = join(getDataDir(), "topics", topicId, "states.json")
  const file = Bun.file(statesPath)
  if (!(await file.exists())) return undefined
  const states = await file.json() as { version: number; verdict_id?: string }[]
  if (!states.length) return undefined

  const latest = states[states.length - 1]
  if (!latest.verdict_id) return undefined

  // Find the expert council file that contains this verdict
  const version = states.length
  const expertPath = join(getDataDir(), "topics", topicId, `expert_council_v${version}.json`)
  const expertFile = Bun.file(expertPath)
  if (!(await expertFile.exists())) return undefined

  const council = await expertFile.json() as {
    final_verdict?: { final_assessment?: string; scenarios_ranked?: { scenario_id: string; probability: number }[] }
  }
  if (!council.final_verdict?.final_assessment) return undefined
  return council.final_verdict.final_assessment.slice(0, 300)
}

export async function buildAgentContext(
  agentType: AgentType,
  topicId: string
): Promise<AgentContextSnapshot> {
  const [current_version, party_index, clue_index] = await Promise.all([
    getTopicVersion(topicId),
    getPartyIndex(topicId),
    getClueIndex(topicId),
  ])

  const snapshot: AgentContextSnapshot = {
    current_version,
    party_index,
    clue_index,
  }

  // Forum summary: needed by expert and verdict agents (not forum agents themselves)
  if (agentType === "expert" || agentType === "verdict") {
    snapshot.forum_summary = await getForumSummary(topicId)
  }

  // Prior verdict summary: only needed for delta agents
  if (agentType === "delta") {
    snapshot.prior_verdict_summary = await getVerdictSummary(topicId)
  }

  return snapshot
}

// Rough token estimator: 1 token ≈ 4 chars
export function estimateTokens(snapshot: AgentContextSnapshot): number {
  return Math.ceil(JSON.stringify(snapshot).length / 4)
}

// Serialize snapshot to a compact string for injection into prompts
export function serializeContext(snapshot: AgentContextSnapshot): string {
  const lines: string[] = [
    `Version: ${snapshot.current_version}`,
    `Parties (${snapshot.party_index.length}): ${snapshot.party_index.map(p => `${p.name} [w=${p.weight}]`).join(", ")}`,
    `Clues (${snapshot.clue_index.length}): ${snapshot.clue_index.map(c => `[${c.id}] ${c.title} (${c.timeline_date})`).join(" | ")}`,
  ]
  if (snapshot.forum_summary) lines.push(`Forum summary: ${snapshot.forum_summary}`)
  if (snapshot.prior_verdict_summary) lines.push(`Prior verdict: ${snapshot.prior_verdict_summary}`)
  return lines.join("\n")
}
