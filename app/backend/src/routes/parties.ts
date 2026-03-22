import { Elysia, t } from "elysia"
import { join } from "path"
import { queuedWrite } from "../pipeline/writeQueue"
import { getTopic } from "../pipeline/topicManager"
import { smartAddParty, smartEditParty, smartSplitParty, smartMergeParties } from "../agents/PartyIntelligence"
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

  // Manual add (bare fields)
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

  // Smart add: name only → LLM + web research → full party profile
  .post("/smart-add", async ({ params, body, error }) => {
    const b = body as { name: string }
    if (!b.name?.trim()) return error(400, { message: "name is required" })

    try {
      const topicId = params.id
      const topic = await getTopic(topicId)
      const existing = await readParties(topicId)

      const party = await smartAddParty(
        topicId, topic.title, topic.description,
        b.name.trim(), topic.models.enrichment, existing,
      )

      await queuedWrite<Party[]>(topicId, partiesPath(topicId),
        (parties) => [...parties, party], [])

      return party
    } catch (e) {
      return error(500, { message: `Smart add failed: ${e}` })
    }
  }, { body: t.Record(t.String(), t.Any()) })

  // Smart edit: user feedback → LLM + web research → updated party
  .post("/:partyId/smart-edit", async ({ params, body, error }) => {
    const b = body as { feedback: string }
    if (!b.feedback?.trim()) return error(400, { message: "feedback is required" })

    try {
      const topicId = params.id
      const topic = await getTopic(topicId)
      const parties = await readParties(topicId)
      const current = parties.find(p => p.id === params.partyId)
      if (!current) return error(404, { message: "Party not found" })

      const updated = await smartEditParty(
        topicId, topic.title, current,
        b.feedback.trim(), topic.models.enrichment,
      )

      await queuedWrite<Party[]>(topicId, partiesPath(topicId), (ps) =>
        ps.map(p => p.id === params.partyId ? { ...updated, id: p.id } : p), [])

      return updated
    } catch (e) {
      return error(500, { message: `Smart edit failed: ${e}` })
    }
  }, { body: t.Record(t.String(), t.Any()) })

  // Split: one party → multiple sub-parties via LLM
  .post("/split", async ({ params, body, error }) => {
    const b = body as { source_id: string; into: { name: string }[] }
    if (!b.source_id) return error(400, { message: "source_id is required" })
    if (!b.into?.length || b.into.length < 2) return error(400, { message: "Need at least 2 target names" })

    try {
      const topicId = params.id
      const topic = await getTopic(topicId)
      const parties = await readParties(topicId)
      const source = parties.find(p => p.id === b.source_id)
      if (!source) return error(404, { message: "Source party not found" })

      const splitNames = b.into.map(i => i.name)
      const newParties = await smartSplitParty(
        topicId, topic.title, source, splitNames, topic.models.enrichment,
      )

      // Remove source, add new parties
      await queuedWrite<Party[]>(topicId, partiesPath(topicId), (ps) =>
        [...ps.filter(p => p.id !== b.source_id), ...newParties], [])

      // Update clue references: source_id → first new party (best-effort)
      const cluesFilePath = join(getDataDir(), "topics", topicId, "clues.json")
      const cluesFile = Bun.file(cluesFilePath)
      if (await cluesFile.exists()) {
        const primaryId = newParties[0]?.id
        if (primaryId) {
          await queuedWrite<any[]>(topicId, cluesFilePath, (clues) => {
            return clues.map((clue: any) => ({
              ...clue,
              versions: clue.versions.map((v: any) => ({
                ...v,
                party_relevance: v.party_relevance.map((pr: string) =>
                  pr === b.source_id ? primaryId : pr
                ),
              })),
            }))
          }, [])
        }
      }

      return { removed: b.source_id, created: newParties }
    } catch (e) {
      return error(500, { message: `Split failed: ${e}` })
    }
  }, { body: t.Record(t.String(), t.Any()) })

  // Smart merge: LLM synthesizes merged profile
  .post("/merge", async ({ params, body, error }) => {
    const b = body as { source_ids: string[]; target: Partial<Party> }
    if (!b.source_ids?.length || b.source_ids.length < 2) {
      return error(400, { message: "Need at least 2 source_ids to merge" })
    }
    if (!b.target?.name) return error(400, { message: "target.name is required" })

    try {
      const topicId = params.id
      const parties = await readParties(topicId)
      const sources = parties.filter(p => b.source_ids.includes(p.id))
      if (sources.length < 2) return error(400, { message: "Not enough matching source parties" })

      // Try LLM-powered smart merge, fall back to manual merge
      let merged: Party
      try {
        const topic = await getTopic(topicId)
        const smartMerged = await smartMergeParties(
          topic.title, sources, b.target.name, topic.models.enrichment,
        )
        merged = smartMerged as Party
      } catch {
        // Fallback: manual merge
        const targetId = b.target.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 30)
        merged = {
          id: targetId,
          name: b.target.name,
          type: b.target.type ?? sources[0].type,
          description: sources.map(s => s.description).join(" "),
          weight: Math.round(sources.reduce((s, p) => s + p.weight, 0) / sources.length),
          weight_factors: sources[0].weight_factors,
          agenda: sources.map(s => s.agenda).filter(Boolean).join("; "),
          means: [...new Set(sources.flatMap(s => s.means))],
          circle: {
            visible: [...new Set(sources.flatMap(s => s.circle?.visible ?? []))],
            shadow: [...new Set(sources.flatMap(s => s.circle?.shadow ?? []))],
          },
          stance: sources[0].stance,
          vulnerabilities: [...new Set(sources.flatMap(s => s.vulnerabilities))],
          auto_discovered: false,
          user_verified: true,
        }
      }

      const targetId = merged.id || b.target.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 30)
      merged.id = targetId

      await queuedWrite<Party[]>(topicId, partiesPath(topicId), (ps) =>
        [...ps.filter(p => !b.source_ids.includes(p.id)), merged], [])

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
    } catch (e) {
      return error(500, { message: `Merge failed: ${e}` })
    }
  }, { body: t.Record(t.String(), t.Any()) })
