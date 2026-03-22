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
