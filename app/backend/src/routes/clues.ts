import { Elysia, t } from "elysia"
import { join } from "path"
import { queuedWrite } from "../pipeline/writeQueue"
import { markStale } from "../pipeline/stateManager"
import type { Clue } from "../tools/processing/storeClue"

function getDataDir() { return process.env.DATA_DIR || "/home/nima/dana/data" }
function cluesPath(topicId: string) { return join(getDataDir(), "topics", topicId, "clues.json") }

async function readClues(topicId: string): Promise<Clue[]> {
  const f = Bun.file(cluesPath(topicId))
  if (!(await f.exists())) return []
  return f.json()
}

export const cluesRouter = new Elysia({ prefix: "/api/topics/:id/clues" })
  .get("/", async ({ params }) => readClues(params.id))

  .get("/:clueId", async ({ params, error }) => {
    const clues = await readClues(params.id)
    const clue = clues.find(c => c.id === params.clueId)
    return clue ?? error(404, { message: "Clue not found" })
  })

  .post("/", async ({ params, body, error }) => {
    try {
      const topicId = params.id
      let newClue: Clue | null = null

      await queuedWrite<Clue[]>(topicId, cluesPath(topicId), (clues) => {
        const id = `clue-${String(clues.length + 1).padStart(3, "0")}`
        const now = new Date().toISOString()
        newClue = {
          id, current: 1, added_at: now, last_updated_at: now,
          added_by: "user", status: "verified",
          versions: [{
            v: 1, date: now,
            title: (body as any).title,
            raw_source: { url: (body as any).source_url || "", fetched_at: now },
            source_credibility: {
              score: (body as any).credibility_score ?? 50,
              notes: (body as any).credibility_notes ?? "",
              bias_flags: (body as any).bias_flags ?? [],
              origin_source: (body as any).origin_source ?? { url: "", outlet: "", is_republication: false },
            },
            bias_corrected_summary: (body as any).bias_corrected_summary ?? "",
            relevance_score: (body as any).relevance_score ?? 50,
            party_relevance: (body as any).party_relevance ?? [],
            domain_tags: (body as any).domain_tags ?? [],
            timeline_date: (body as any).timeline_date ?? now.slice(0, 10),
            clue_type: (body as any).clue_type ?? "event",
            change_note: "User-submitted initial version",
            key_points: (body as any).key_points ?? [],
          }],
        }
        return [...clues, newClue!]
      }, [])

      await markStale(topicId)
      return newClue
    } catch (e) {
      return error(400, { message: String(e) })
    }
  }, { body: t.Record(t.String(), t.Any()) })

  // Inline edit — update fields on current version without creating new version
  .put("/:clueId", async ({ params, body, error }) => {
    const b = body as Record<string, unknown>
    let updated: Clue | null = null

    await queuedWrite<Clue[]>(params.id, cluesPath(params.id), (clues) => {
      return clues.map(c => {
        if (c.id !== params.clueId) return c
        const curIdx = c.versions.findIndex(v => v.v === c.current)
        if (curIdx === -1) return c
        const cur = { ...c.versions[curIdx] }

        if (b.title !== undefined) cur.title = b.title as string
        if (b.bias_corrected_summary !== undefined) cur.bias_corrected_summary = b.bias_corrected_summary as string
        if (b.relevance_score !== undefined) cur.relevance_score = b.relevance_score as number
        if (b.party_relevance !== undefined) cur.party_relevance = b.party_relevance as string[]
        if (b.domain_tags !== undefined) cur.domain_tags = b.domain_tags as string[]
        if (b.timeline_date !== undefined) cur.timeline_date = b.timeline_date as string
        if (b.clue_type !== undefined) cur.clue_type = b.clue_type as string
        if (b.credibility_score !== undefined) {
          cur.source_credibility = { ...cur.source_credibility, score: b.credibility_score as number }
        }
        if (b.bias_flags !== undefined) {
          cur.source_credibility = { ...cur.source_credibility, bias_flags: b.bias_flags as string[] }
        }
        if (b.credibility_notes !== undefined) {
          cur.source_credibility = { ...cur.source_credibility, notes: b.credibility_notes as string }
        }

        const versions = [...c.versions]
        versions[curIdx] = cur
        updated = { ...c, versions, last_updated_at: new Date().toISOString() }
        return updated
      })
    }, [])

    return updated ?? error(404, { message: "Clue not found" })
  }, { body: t.Record(t.String(), t.Any()) })

  .delete("/:clueId", async ({ params }) => {
    await queuedWrite<Clue[]>(params.id, cluesPath(params.id),
      (clues) => clues.filter(c => c.id !== params.clueId), [])
    await markStale(params.id)
    return { success: true }
  })

  // Smart edit: user feedback → LLM + research → updated clue
  .post("/:clueId/smart-edit", async ({ params, body, error }) => {
    const b = body as { feedback: string }
    if (!b.feedback?.trim()) return error(400, { message: "feedback is required" })

    const { getTopic } = await import("../pipeline/topicManager")
    const { smartEditClue } = await import("../agents/SmartClueExtractor")

    const topicId = params.id
    const topic = await getTopic(topicId)
    const clues = await readClues(topicId)
    const clue = clues.find(c => c.id === params.clueId)
    if (!clue) return error(404, { message: "Clue not found" })

    const cur = clue.versions.find(v => v.v === clue.current)!
    const currentData = {
      title: cur.title,
      summary: cur.bias_corrected_summary,
      credibility: cur.source_credibility.score,
      bias_flags: cur.source_credibility.bias_flags,
      relevance: cur.relevance_score,
      parties: cur.party_relevance,
      source_url: cur.raw_source?.url || "",
      source_outlet: cur.source_credibility.origin_source?.outlet || "",
      date: cur.timeline_date,
      clue_type: cur.clue_type,
    }

    try {
      const updated = await smartEditClue(topicId, topic.title, currentData, b.feedback.trim(), topic.models.enrichment)

      let result: Clue | null = null
      await queuedWrite<Clue[]>(topicId, cluesPath(topicId), (allClues) => {
        return allClues.map(c => {
          if (c.id !== params.clueId) return c
          const curIdx = c.versions.findIndex(v => v.v === c.current)
          if (curIdx === -1) return c
          const v = { ...c.versions[curIdx] }
          v.title = updated.title
          v.bias_corrected_summary = updated.summary
          v.relevance_score = updated.relevance
          v.party_relevance = updated.parties
          v.timeline_date = updated.date
          v.clue_type = updated.clue_type
          v.domain_tags = updated.domain_tags ?? v.domain_tags
          v.source_credibility = {
            ...v.source_credibility,
            score: updated.credibility,
            bias_flags: updated.bias_flags,
          }
          const versions = [...c.versions]
          versions[curIdx] = v
          result = { ...c, versions, last_updated_at: new Date().toISOString() }
          return result
        })
      }, [])

      return result ?? error(500, { message: "Failed to update clue" })
    } catch (e) {
      return error(500, { message: `Smart edit failed: ${e}` })
    }
  }, { body: t.Record(t.String(), t.Any()) })

  // Smart bulk import: mixed text with embedded URLs → extract + fetch + structured clues
  .post("/bulk", async ({ params, body, error }) => {
    const { getTopic } = await import("../pipeline/topicManager")
    const { smartExtractClues } = await import("../agents/SmartClueExtractor")

    const b = body as { content: string; type?: string }
    if (!b.content?.trim()) return error(400, { message: "content is required" })

    const topicId = params.id
    const topic = await getTopic(topicId)

    // Load parties for context
    const partiesFile = Bun.file(join(getDataDir(), "topics", topicId, "parties.json"))
    const parties = await partiesFile.exists() ? await partiesFile.json() : []

    // Use enrichment model for better extraction quality
    const extracted = await smartExtractClues(
      topicId, topic.title, topic.description,
      b.content, parties, topic.models.enrichment,
    )

    // Store each extracted clue
    const created: Clue[] = []
    for (const item of extracted) {
      const now = new Date().toISOString()
      let newClue: Clue | null = null
      await queuedWrite<Clue[]>(topicId, cluesPath(topicId), (clues) => {
        const id = `clue-${String(clues.length + 1).padStart(3, "0")}`
        newClue = {
          id, current: 1, added_at: now, last_updated_at: now,
          added_by: "user", status: "verified",
          versions: [{
            v: 1, date: now, title: item.title,
            raw_source: { url: item.source_url || "", fetched_at: now },
            source_credibility: {
              score: item.credibility ?? 50,
              notes: `Source: ${item.source_outlet || "user-submitted"}`,
              bias_flags: item.bias_flags ?? [],
              origin_source: {
                url: item.source_url || "",
                outlet: item.source_outlet || "user",
                is_republication: false,
              },
            },
            bias_corrected_summary: item.summary,
            relevance_score: item.relevance ?? 70,
            party_relevance: item.parties ?? [],
            domain_tags: item.domain_tags ?? [],
            timeline_date: item.date || now.slice(0, 10),
            clue_type: item.clue_type || "event",
            change_note: "Smart bulk import",
            key_points: item.key_points ?? [],
          }],
        }
        return [...clues, newClue!]
      }, [])
      if (newClue) created.push(newClue)
    }

    if (created.length > 0) await markStale(topicId)
    return { imported: created.length, clues: created }
  }, { body: t.Record(t.String(), t.Any()) })
