import { Elysia, t } from "elysia"
import { join } from "path"
import { queuedWrite } from "../pipeline/writeQueue"
import type { Party } from "../agents/DiscoveryAgent"

function getDataDir() { return process.env.DATA_DIR || "/home/nima/dana/data" }
function partiesPath(topicId: string) { return join(getDataDir(), "topics", topicId, "parties.json") }

async function readParties(topicId: string): Promise<Party[]> {
  const f = Bun.file(partiesPath(topicId))
  if (!(await f.exists())) return []
  return f.json()
}

export const partiesRouter = new Elysia({ prefix: "/api/topics/:id/parties" })
  .get("/", async ({ params }) => readParties(params.id))

  .get("/:partyId", async ({ params, error }) => {
    const parties = await readParties(params.id)
    const party = parties.find(p => p.id === params.partyId)
    return party ?? error(404, { message: "Party not found" })
  })

  .post("/", async ({ params, body, error }) => {
    try {
      const b = body as Partial<Party>
      if (!b.name) return error(400, { message: "name is required" })
      const id = (b.id || b.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 30))
      const party: Party = {
        id, name: b.name, type: b.type ?? "non_state",
        description: b.description ?? "", weight: b.weight ?? 0,
        weight_factors: b.weight_factors ?? { military_capacity: 0, economic_control: 0, information_control: 0, international_support: 0, internal_legitimacy: 0 },
        agenda: b.agenda ?? "", means: b.means ?? [],
        circle: b.circle ?? { visible: [], shadow: [] },
        stance: b.stance ?? "passive", vulnerabilities: b.vulnerabilities ?? [],
        auto_discovered: false, user_verified: true,
      }
      await queuedWrite<Party[]>(params.id, partiesPath(params.id),
        (parties) => [...parties, party], [])
      return party
    } catch (e) {
      return error(400, { message: String(e) })
    }
  }, { body: t.Record(t.String(), t.Any()) })

  .put("/:partyId", async ({ params, body, error }) => {
    try {
      let updated: Party | null = null
      await queuedWrite<Party[]>(params.id, partiesPath(params.id), (parties) => {
        return parties.map(p => {
          if (p.id !== params.partyId) return p
          updated = { ...p, ...(body as Partial<Party>), id: p.id }
          return updated
        })
      }, [])
      return updated ?? error(404, { message: "Party not found" })
    } catch (e) {
      return error(400, { message: String(e) })
    }
  }, { body: t.Record(t.String(), t.Any()) })

  .delete("/:partyId", async ({ params }) => {
    await queuedWrite<Party[]>(params.id, partiesPath(params.id),
      (parties) => parties.filter(p => p.id !== params.partyId), [])
    return { success: true }
  })

  .post("/merge", async ({ params, body, error }) => {
    const b = body as { source_ids: string[]; target: Partial<Party> }
    if (!b.source_ids?.length || b.source_ids.length < 2) {
      return error(400, { message: "Need at least 2 source_ids to merge" })
    }
    if (!b.target?.name) return error(400, { message: "target.name is required" })

    const topicId = params.id
    const targetId = b.target.id || b.target.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 30)
    let merged: Party | null = null

    await queuedWrite<Party[]>(topicId, partiesPath(topicId), (parties) => {
      const sources = parties.filter(p => b.source_ids.includes(p.id))
      if (sources.length < 2) throw new Error("Not enough matching source parties found")

      // Merge: combine means, circles, vulnerabilities from all sources
      const allMeans = [...new Set(sources.flatMap(s => s.means))]
      const allVisible = [...new Set(sources.flatMap(s => s.circle?.visible ?? []))]
      const allShadow = [...new Set(sources.flatMap(s => s.circle?.shadow ?? []))]
      const allVulns = [...new Set(sources.flatMap(s => s.vulnerabilities))]
      const avgWeight = Math.round(sources.reduce((s, p) => s + p.weight, 0) / sources.length)

      merged = {
        id: targetId,
        name: b.target.name!,
        type: b.target.type ?? sources[0].type,
        description: b.target.description ?? sources.map(s => s.description).join(" "),
        weight: b.target.weight ?? avgWeight,
        weight_factors: b.target.weight_factors ?? sources[0].weight_factors,
        agenda: b.target.agenda ?? sources.map(s => s.agenda).filter(Boolean).join("; "),
        means: b.target.means ?? allMeans,
        circle: b.target.circle ?? { visible: allVisible, shadow: allShadow },
        stance: b.target.stance ?? sources[0].stance,
        vulnerabilities: b.target.vulnerabilities ?? allVulns,
        auto_discovered: false,
        user_verified: true,
      }

      return [...parties.filter(p => !b.source_ids.includes(p.id)), merged!]
    }, [])

    // Update clue party_relevance references
    const cluesFilePath = join(getDataDir(), "topics", topicId, "clues.json")
    const cluesFile = Bun.file(cluesFilePath)
    if (await cluesFile.exists()) {
      await queuedWrite<any[]>(topicId, cluesFilePath, (clues) => {
        return clues.map((clue: any) => ({
          ...clue,
          versions: clue.versions.map((v: any) => ({
            ...v,
            party_relevance: v.party_relevance.map((pr: string) =>
              b.source_ids.includes(pr) ? targetId : pr
            ).filter((pr: string, i: number, arr: string[]) => arr.indexOf(pr) === i),
          })),
        }))
      }, [])
    }

    return merged
  }, { body: t.Record(t.String(), t.Any()) })
