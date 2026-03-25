import { getDb } from "../database"

export interface ClueSnapshot {
  count: number
  ids_and_versions: Record<string, number>
}

export interface DeltaSummary {
  new_clues: string[]
  updated_clues: string[]
  affected_parties: string[]
  key_change: string
}

export interface KnowledgeState {
  version: number
  label: string
  created_at: string
  trigger: "initial_run" | "user_add_clue" | "user_edit_clue" | "auto_refresh" | "user_manual"
  clue_snapshot: ClueSnapshot
  forum_session_id: string | null
  verdict_id: string | null
  delta_from: number | null
  delta_summary: DeltaSummary | null
}

type StateRow = {
  id: number
  topic_id: string
  version: number
  label: string
  created_at: string
  trigger: string
  clue_snapshot: string
  forum_session_id: string | null
  verdict_id: string | null
  delta_from: number | null
  delta_summary: string | null
}

function rowToState(row: StateRow): KnowledgeState {
  return {
    version: row.version,
    label: row.label,
    created_at: row.created_at,
    trigger: row.trigger as KnowledgeState["trigger"],
    clue_snapshot: JSON.parse(row.clue_snapshot),
    forum_session_id: row.forum_session_id,
    verdict_id: row.verdict_id,
    delta_from: row.delta_from,
    delta_summary: row.delta_summary ? JSON.parse(row.delta_summary) : null,
  }
}

export function dbGetAllStates(topicId: string): KnowledgeState[] {
  const rows = getDb().query<StateRow, [string]>(
    "SELECT * FROM states WHERE topic_id = ? ORDER BY version ASC"
  ).all(topicId)
  return rows.map(rowToState)
}

export function dbGetLatestState(topicId: string): KnowledgeState | null {
  const row = getDb().query<StateRow, [string]>(
    "SELECT * FROM states WHERE topic_id = ? ORDER BY version DESC LIMIT 1"
  ).get(topicId)
  return row ? rowToState(row) : null
}

export function dbInsertState(topicId: string, state: KnowledgeState): void {
  getDb().run(
    `INSERT INTO states (topic_id, version, label, created_at, trigger, clue_snapshot, forum_session_id, verdict_id, delta_from, delta_summary)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [topicId, state.version, state.label, state.created_at, state.trigger,
     JSON.stringify(state.clue_snapshot), state.forum_session_id, state.verdict_id,
     state.delta_from, state.delta_summary ? JSON.stringify(state.delta_summary) : null]
  )
}
