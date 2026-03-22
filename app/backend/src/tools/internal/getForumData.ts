import { join } from "path"

function getDataDir() { return process.env.DATA_DIR || "/home/nima/dana/data" }

export interface ForumTurn {
  id: string
  representative_id: string
  party_name: string
  party_color?: string
  statement: string
  clues_cited: string[]
  timestamp: string
  round: number
  type: string
  word_count: number
}

export interface ForumScenario {
  id: string
  title: string
  description: string
  proposed_by: string
  supported_by: string[]
  contested_by: string[]
  clues_cited: string[]
  benefiting_parties: string[]
  required_conditions: string[]
  falsification_conditions: string[]
}

export interface ScenarioSummary {
  scenarios: {
    id: string
    title: string
    key_clues: string[]
    required_conditions: string[]
    falsification_conditions: string[]
  }[]
  contested_clues: {
    clue_id: string
    cited_by: string[]
    conflict: string
  }[]
  uncontested_clues: string[]
}

export interface ForumSession {
  session_id: string
  version: number
  type: "full" | "delta"
  status: "running" | "complete" | "error"
  started_at: string
  completed_at?: string
  rounds: { round: number; type: string; turns: ForumTurn[] }[]
  scenarios: ForumScenario[]
  scenario_summary?: ScenarioSummary
}

function sessionPath(topicId: string, sessionId: string): string {
  return join(getDataDir(), "topics", topicId, `${sessionId}.json`)
}

async function loadSession(topicId: string, sessionId: string): Promise<ForumSession> {
  const file = Bun.file(sessionPath(topicId, sessionId))
  if (!(await file.exists())) throw new Error(`Forum session not found: ${sessionId}`)
  return file.json()
}

export async function getPriorTurns(
  topicId: string,
  sessionId: string,
  opts: { round?: number; party_id?: string } = {}
): Promise<ForumTurn[]> {
  const session = await loadSession(topicId, sessionId)
  const allTurns = session.rounds.flatMap(r => r.turns)

  return allTurns.filter(t => {
    if (opts.round !== undefined && t.round !== opts.round) return false
    if (opts.party_id !== undefined && t.representative_id !== `rep-${opts.party_id}`) return false
    return true
  })
}

export async function getScenarioList(topicId: string, sessionId: string): Promise<ForumScenario[]> {
  const session = await loadSession(topicId, sessionId)
  return session.scenarios
}

export async function getScenarioSummary(topicId: string, sessionId: string): Promise<ScenarioSummary | null> {
  const session = await loadSession(topicId, sessionId)
  return session.scenario_summary ?? null
}

export async function getForumSession(topicId: string, sessionId: string): Promise<ForumSession> {
  return loadSession(topicId, sessionId)
}

export async function writeForumSession(topicId: string, session: ForumSession): Promise<void> {
  const path = sessionPath(topicId, session.session_id)
  await Bun.write(path, JSON.stringify(session, null, 2))
}
