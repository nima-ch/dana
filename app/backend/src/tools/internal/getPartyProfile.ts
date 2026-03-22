import { join } from "path"
import type { Party } from "../../agents/DiscoveryAgent"

function getDataDir() { return process.env.DATA_DIR || "/home/nima/dana/data" }

export async function getPartyProfile(topicId: string, partyId: string): Promise<Party> {
  const path = join(getDataDir(), "topics", topicId, "parties.json")
  const file = Bun.file(path)
  if (!(await file.exists())) throw new Error(`parties.json not found for topic ${topicId}`)
  const parties = await file.json() as Party[]
  const party = parties.find(p => p.id === partyId)
  if (!party) throw new Error(`Party ${partyId} not found`)
  return party
}

export async function getPartyIndex(topicId: string): Promise<{ id: string; name: string; weight: number }[]> {
  const path = join(getDataDir(), "topics", topicId, "parties.json")
  const file = Bun.file(path)
  if (!(await file.exists())) return []
  const parties = await file.json() as Party[]
  return parties.map(p => ({ id: p.id, name: p.name, weight: p.weight }))
}
