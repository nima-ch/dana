import { join } from "path"
import { queuedWrite } from "./writeQueue"
import type { Clue } from "../tools/processing/storeClue"

function getDataDir() { return process.env.DATA_DIR || "/home/nima/dana/data" }

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

function statesPath(topicId: string): string {
  return join(getDataDir(), "topics", topicId, "states.json")
}

function topicPath(topicId: string): string {
  return join(getDataDir(), "topics", topicId, "topic.json")
}

async function readJSON<T>(path: string, fallback: T): Promise<T> {
  const f = Bun.file(path)
  if (!(await f.exists())) return fallback
  return f.json() as Promise<T>
}

export async function getCurrentClueSnapshot(topicId: string): Promise<ClueSnapshot> {
  const clues = await readJSON<Clue[]>(
    join(getDataDir(), "topics", topicId, "clues.json"), []
  )
  const ids_and_versions: Record<string, number> = {}
  for (const clue of clues) ids_and_versions[clue.id] = clue.current
  return { count: clues.length, ids_and_versions }
}

export async function getLatestVersion(topicId: string): Promise<KnowledgeState | null> {
  const states = await readJSON<KnowledgeState[]>(statesPath(topicId), [])
  return states.length ? states[states.length - 1] : null
}

export async function getAllVersions(topicId: string): Promise<KnowledgeState[]> {
  return readJSON<KnowledgeState[]>(statesPath(topicId), [])
}

export async function createVersion(
  topicId: string,
  opts: {
    label: string
    trigger: KnowledgeState["trigger"]
    forum_session_id?: string
    verdict_id?: string
    delta_from?: number
    delta_summary?: DeltaSummary
  }
): Promise<KnowledgeState> {
  const clue_snapshot = await getCurrentClueSnapshot(topicId)
  const states = await readJSON<KnowledgeState[]>(statesPath(topicId), [])
  const version = states.length + 1

  const state: KnowledgeState = {
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

  await queuedWrite<KnowledgeState[]>(topicId, statesPath(topicId), (s) => [...s, state], [])

  // Update topic.json current_version and status
  await queuedWrite<Record<string, unknown>>(topicId, topicPath(topicId), (t) => ({
    ...t,
    current_version: version,
    status: "complete",
    updated_at: new Date().toISOString(),
  }), {})

  return state
}

export async function markStale(topicId: string): Promise<void> {
  await queuedWrite<Record<string, unknown>>(topicId, topicPath(topicId), (t) => ({
    ...t,
    status: "stale",
    updated_at: new Date().toISOString(),
  }), {})
}

export async function computeDelta(topicId: string): Promise<DeltaSummary | null> {
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
  const clues = await readJSON<Clue[]>(
    join(getDataDir(), "topics", topicId, "clues.json"), []
  )
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
