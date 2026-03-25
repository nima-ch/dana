import { dbGetAllStates, dbGetLatestState, dbInsertState } from "../db/queries/states"
import { dbGetClues } from "../db/queries/clues"
import { dbUpdateTopic } from "../db/queries/topics"

// Re-export types for compatibility
export type { KnowledgeState, ClueSnapshot, DeltaSummary } from "../db/queries/states"

export async function getCurrentClueSnapshot(topicId: string) {
  const clues = dbGetClues(topicId)
  const ids_and_versions: Record<string, number> = {}
  for (const clue of clues) ids_and_versions[clue.id] = clue.current
  return { count: clues.length, ids_and_versions }
}

export async function getLatestVersion(topicId: string) {
  return dbGetLatestState(topicId)
}

export async function getAllVersions(topicId: string) {
  return dbGetAllStates(topicId)
}

export async function createVersion(
  topicId: string,
  opts: {
    label: string
    trigger: "initial_run" | "user_add_clue" | "user_edit_clue" | "auto_refresh" | "user_manual"
    forum_session_id?: string
    verdict_id?: string
    delta_from?: number
    delta_summary?: import("../db/queries/states").DeltaSummary
  }
) {
  const clue_snapshot = await getCurrentClueSnapshot(topicId)
  const states = dbGetAllStates(topicId)
  const version = states.length + 1

  const state = {
    version,
    label: opts.label,
    created_at: new Date().toISOString(),
    trigger: opts.trigger,
    clue_snapshot,
    forum_session_id: opts.forum_session_id ?? null,
    verdict_id: opts.verdict_id ?? null,
    delta_from: opts.delta_from ?? null,
    delta_summary: opts.delta_summary ?? null,
  }

  dbInsertState(topicId, state)

  // Update topic current_version and status
  dbUpdateTopic(topicId, { current_version: version, status: "complete" })

  return state
}

export async function markStale(topicId: string): Promise<void> {
  dbUpdateTopic(topicId, { status: "stale" })
}

export async function computeDelta(topicId: string) {
  const latest = await getLatestVersion(topicId)
  if (!latest) return null

  const current = await getCurrentClueSnapshot(topicId)
  const prev = latest.clue_snapshot

  const newClues: string[] = []
  const updatedClues: string[] = []
  const affectedParties = new Set<string>()

  for (const [id, version] of Object.entries(current.ids_and_versions)) {
    if (!(id in prev.ids_and_versions)) {
      newClues.push(id)
    } else if (prev.ids_and_versions[id] !== version) {
      updatedClues.push(id)
    }
  }

  // Collect affected parties from new/updated clues
  const clues = dbGetClues(topicId)
  for (const id of [...newClues, ...updatedClues]) {
    const clue = clues.find(c => c.id === id)
    if (clue) {
      const cur = clue.versions.find(v => v.v === clue.current)
      cur?.party_relevance.forEach(p => affectedParties.add(p))
    }
  }

  if (newClues.length === 0 && updatedClues.length === 0) return null

  return {
    new_clues: newClues,
    updated_clues: updatedClues,
    affected_parties: [...affectedParties],
    key_change: `${newClues.length} new clue(s), ${updatedClues.length} updated clue(s)`,
  }
}
