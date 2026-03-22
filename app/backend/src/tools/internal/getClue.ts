import { join } from "path"
import type { Clue } from "../processing/storeClue"

function getDataDir() { return process.env.DATA_DIR || "/home/nima/dana/data" }

export async function getClue(topicId: string, clueId: string, version?: number): Promise<Clue["versions"][number]> {
  const path = join(getDataDir(), "topics", topicId, "clues.json")
  const file = Bun.file(path)
  if (!(await file.exists())) throw new Error(`clues.json not found for topic ${topicId}`)
  const clues = await file.json() as Clue[]
  const clue = clues.find(c => c.id === clueId)
  if (!clue) throw new Error(`Clue ${clueId} not found`)
  const v = version ?? clue.current
  const entry = clue.versions.find(ver => ver.v === v)
  if (!entry) throw new Error(`Clue ${clueId} version ${v} not found`)
  return entry
}

export async function getClueIndex(topicId: string): Promise<{ id: string; title: string; timeline_date: string; party_relevance: string[]; relevance_score: number }[]> {
  const path = join(getDataDir(), "topics", topicId, "clues.json")
  const file = Bun.file(path)
  if (!(await file.exists())) return []
  const clues = await file.json() as Clue[]
  return clues.map(c => {
    const cur = c.versions.find(v => v.v === c.current)!
    return {
      id: c.id,
      title: cur.title,
      timeline_date: cur.timeline_date,
      party_relevance: cur.party_relevance,
      relevance_score: cur.relevance_score,
    }
  })
}
