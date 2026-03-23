import { Elysia, t } from "elysia"
import { join } from "path"
import { queuedWrite } from "../pipeline/writeQueue"
import { markStale } from "../pipeline/stateManager"
import type { Clue } from "../tools/processing/storeClue"

function getDataDir() { return process.env.DATA_DIR || "/home/nima/dana/data" }
function cluesPath(topicId: string) { return join(getDataDir(), "topics", topicId, "clues.json") }

const cleanupJobs = new Map<string, { status: string; groups: any[] | null; original_count: number; error?: string }>()

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
  .post("/smart-edit/:clueId", async ({ params, body, set }) => {
    const b = body as { feedback: string }
    if (!b.feedback?.trim()) {
      set.status = 400
      return { message: "feedback is required" }
    }

    const { getTopic } = await import("../pipeline/topicManager")
    const { smartEditClue } = await import("../agents/SmartClueExtractor")

    const topicId = params.id
    const topic = await getTopic(topicId)
    const clues = await readClues(topicId)
    const clue = clues.find(c => c.id === params.clueId)
    if (!clue) {
      set.status = 404
      return { message: "Clue not found" }
    }

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

      if (!result) {
        set.status = 500
        return { message: "Failed to update clue" }
      }
      return result
    } catch (e) {
      set.status = 500
      return { message: `Smart edit failed: ${e}` }
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

  // Research: user gives a direction → system searches, fetches, extracts clues
  .post("/research", async ({ params, body, error }) => {
    const { getTopic } = await import("../pipeline/topicManager")
    const { researchAndExtractClues } = await import("../agents/SmartClueExtractor")

    const b = body as { query: string }
    if (!b.query?.trim()) return error(400, { message: "query is required" })

    const topicId = params.id
    const topic = await getTopic(topicId)

    const partiesFile = Bun.file(join(getDataDir(), "topics", topicId, "parties.json"))
    const parties = await partiesFile.exists() ? await partiesFile.json() : []

    const extracted = await researchAndExtractClues(
      topicId, topic.title, topic.description,
      b.query.trim(), parties, topic.models.enrichment,
    )

    const created: Clue[] = []
    for (const item of extracted) {
      const now = new Date().toISOString()
      let newClue: Clue | null = null
      await queuedWrite<Clue[]>(topicId, cluesPath(topicId), (clues) => {
        const id = `clue-${String(clues.length + 1).padStart(3, "0")}`
        newClue = {
          id, current: 1, added_at: now, last_updated_at: now,
          added_by: "research", status: "verified",
          versions: [{
            v: 1, date: now, title: item.title,
            raw_source: { url: item.source_url || "", fetched_at: now },
            source_credibility: {
              score: item.credibility ?? 50,
              notes: `Research: ${b.query.slice(0, 60)}`,
              bias_flags: item.bias_flags ?? [],
              origin_source: { url: item.source_url || "", outlet: item.source_outlet || "research", is_republication: false },
            },
            bias_corrected_summary: item.summary,
            relevance_score: item.relevance ?? 70,
            party_relevance: item.parties ?? [],
            domain_tags: item.domain_tags ?? [],
            timeline_date: item.date || now.slice(0, 10),
            clue_type: item.clue_type || "event",
            change_note: `Research query: ${b.query.slice(0, 80)}`,
            key_points: item.key_points ?? [],
          }],
        }
        return [...clues, newClue!]
      }, [])
      if (newClue) created.push(newClue)
    }

    if (created.length > 0) await markStale(topicId)
    return { imported: created.length, clues: created, query: b.query }
  }, { body: t.Record(t.String(), t.Any()) })

  // Cleanup: categorize and propose consolidation groups (fire-and-forget + poll)
  .post("/cleanup/propose", async ({ params }) => {
    const topicId = params.id

    // Start background job
    if (!cleanupJobs.has(topicId) || cleanupJobs.get(topicId)!.status === "done" || cleanupJobs.get(topicId)!.status === "error") {
      cleanupJobs.set(topicId, { status: "running", groups: null, original_count: 0 })

      ;(async () => {
        try {
          const { getTopic } = await import("../pipeline/topicManager")
          const { categorizeAndCleanup } = await import("../agents/SmartClueExtractor")
          const topic = await getTopic(topicId)
          const clues = await readClues(topicId)
          const partiesFile = Bun.file(join(getDataDir(), "topics", topicId, "parties.json"))
          const parties = await partiesFile.exists() ? await partiesFile.json() : []

          const clueData = clues.map(c => {
            const cur = c.versions.find(v => v.v === c.current)!
            return {
              id: c.id, title: cur.title, summary: cur.bias_corrected_summary,
              date: cur.timeline_date, credibility: cur.source_credibility.score,
              relevance: cur.relevance_score, parties: cur.party_relevance,
              clue_type: cur.clue_type, bias_flags: cur.source_credibility.bias_flags,
              domain_tags: cur.domain_tags,
            }
          })

          const groups = await categorizeAndCleanup(topicId, topic.title, clueData, parties, topic.models.enrichment)
          cleanupJobs.set(topicId, { status: "done", groups, original_count: clues.length })
        } catch (e) {
          cleanupJobs.set(topicId, { status: "error", groups: null, original_count: 0, error: String(e) })
        }
      })()
    }

    return { status: cleanupJobs.get(topicId)!.status }
  })

  .get("/cleanup/status", async ({ params }) => {
    const job = cleanupJobs.get(params.id)
    if (!job) return { status: "none" }
    if (job.status === "done") {
      const result = { status: "done", groups: job.groups, original_count: job.original_count }
      return result
    }
    return { status: job.status, error: (job as any).error }
  })

  // Cleanup: apply approved groups (merge/delete)
  .post("/cleanup/apply", async ({ params, body, set }) => {
    const b = body as { groups: any[] }
    if (!b.groups?.length) { set.status = 400; return { message: "No groups provided" } }

    const topicId = params.id
    const groups = b.groups
    const now = new Date().toISOString()

    // Collect IDs to delete (from merge and delete groups)
    const idsToDelete = new Set<string>()
    const newClues: Clue[] = []

    for (const g of groups) {
      if (g.action === "keep") continue
      if (g.action === "delete") {
        for (const id of g.source_clue_ids) idsToDelete.add(id)
        continue
      }
      if (g.action === "merge") {
        for (const id of g.source_clue_ids) idsToDelete.add(id)
        newClues.push({
          id: `clue-${g.group_id}`,
          current: 1,
          added_at: now,
          last_updated_at: now,
          added_by: "cleanup",
          status: "verified",
          versions: [{
            v: 1, date: now, title: g.merged_title,
            raw_source: { url: "", fetched_at: now },
            source_credibility: {
              score: g.merged_credibility ?? 60,
              notes: `Merged from ${g.source_clue_ids.length} clues`,
              bias_flags: g.merged_bias_flags ?? [],
              origin_source: { url: "", outlet: "consolidated", is_republication: false },
            },
            bias_corrected_summary: g.merged_summary,
            relevance_score: g.merged_relevance ?? 70,
            party_relevance: g.merged_parties ?? [],
            domain_tags: g.merged_domain_tags ?? [],
            timeline_date: g.merged_date || now.slice(0, 10),
            clue_type: g.merged_clue_type || "event",
            change_note: `Cleanup merge: ${g.reason}`,
            key_points: [],
          }],
        })
      }
    }

    // Apply: remove old clues, add new merged ones
    await queuedWrite<Clue[]>(topicId, cluesPath(topicId), (allClues) => {
      const filtered = allClues.filter(c => !idsToDelete.has(c.id))
      return [...filtered, ...newClues]
    }, [])

    // Re-number clue IDs for consistency
    await queuedWrite<Clue[]>(topicId, cluesPath(topicId), (allClues) => {
      return allClues.map((c, i) => ({
        ...c,
        id: `clue-${String(i + 1).padStart(3, "0")}`,
      }))
    }, [])

    await markStale(topicId)

    const finalClues = await readClues(topicId)
    return {
      original_count: groups.reduce((sum: number, g: any) => sum + (g.source_clue_ids?.length || 0), 0),
      merged: newClues.length,
      deleted: idsToDelete.size - newClues.length,
      final_count: finalClues.length,
    }
  }, { body: t.Record(t.String(), t.Any()) })
