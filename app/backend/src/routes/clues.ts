import { Elysia, t } from "elysia"
import { markStale } from "../pipeline/stateManager"
import { dbGetClues, dbGetClue, dbInsertClue, dbUpdateClueVersion, dbDeleteClue,
         dbReplaceClues, dbNextClueId, dbCountClues } from "../db/queries/clues"
import type { Clue, ClueVersion } from "../db/queries/clues"

const cleanupJobs = new Map<string, { status: string; groups: any[] | null; original_count: number; error?: string }>()
const bulkImportJobs = new Map<string, { status: string; imported: number; error?: string }>()

export const cluesRouter = new Elysia({ prefix: "/api/topics/:id/clues" })
  .get("/", async ({ params }) => dbGetClues(params.id))

  .get("/:clueId", async ({ params, error }) => {
    const clue = dbGetClue(params.id, params.clueId)
    return clue ?? error(404, { message: "Clue not found" })
  })

  .post("/", async ({ params, body, error }) => {
    try {
      const topicId = params.id
      const b = body as Record<string, any>
      const id = dbNextClueId(topicId)
      const now = new Date().toISOString()
      const timelineDate = b.timeline_date ?? now.slice(0, 10)

      const sourceUrls = b.source_urls ?? (b.source_url ? [b.source_url] : [])
      const sourceOutlets = b.source_outlets ?? []

      const version: ClueVersion = {
        v: 1, date: now,
        title: b.title,
        raw_source: { urls: sourceUrls, outlets: sourceOutlets, fetched_at: now },
        source_credibility: {
          score: b.credibility_score ?? 50,
          notes: b.credibility_notes ?? "",
          bias_flags: b.bias_flags ?? [],
          origin_sources: sourceUrls.map((url: string, i: number) => ({
            url, outlet: sourceOutlets[i] ?? "", is_republication: false,
          })),
        },
        bias_corrected_summary: b.bias_corrected_summary ?? "",
        relevance_score: b.relevance_score ?? 50,
        party_relevance: b.party_relevance ?? [],
        domain_tags: b.domain_tags ?? [],
        timeline_date: timelineDate,
        clue_type: b.clue_type ?? "event",
        change_note: "User-submitted initial version",
        key_points: b.key_points ?? [],
      }

      dbInsertClue(topicId, {
        id, current: 1, added_at: now, last_updated_at: now,
        added_by: "user", status: "verified", version,
      })

      await markStale(topicId)
      return dbGetClue(topicId, id)
    } catch (e) {
      return error(400, { message: String(e) })
    }
  }, { body: t.Record(t.String(), t.Any()) })

  .put("/:clueId", async ({ params, body, error }) => {
    const b = body as Record<string, unknown>
    const clue = dbGetClue(params.id, params.clueId)
    if (!clue) return error(404, { message: "Clue not found" })

    const cur = clue.versions.find(v => v.v === clue.current)!
    const patch: Partial<ClueVersion> = {}

    if (b.title !== undefined) patch.title = b.title as string
    if (b.bias_corrected_summary !== undefined) patch.bias_corrected_summary = b.bias_corrected_summary as string
    if (b.relevance_score !== undefined) patch.relevance_score = b.relevance_score as number
    if (b.party_relevance !== undefined) patch.party_relevance = b.party_relevance as string[]
    if (b.domain_tags !== undefined) patch.domain_tags = b.domain_tags as string[]
    if (b.timeline_date !== undefined) patch.timeline_date = b.timeline_date as string
    if (b.clue_type !== undefined) patch.clue_type = b.clue_type as string
    if (b.credibility_score !== undefined || b.bias_flags !== undefined || b.credibility_notes !== undefined) {
      patch.source_credibility = {
        ...cur.source_credibility,
        ...(b.credibility_score !== undefined ? { score: b.credibility_score as number } : {}),
        ...(b.bias_flags !== undefined ? { bias_flags: b.bias_flags as string[] } : {}),
        ...(b.credibility_notes !== undefined ? { notes: b.credibility_notes as string } : {}),
      }
    }

    dbUpdateClueVersion(params.id, params.clueId, patch)
    return dbGetClue(params.id, params.clueId)
  }, { body: t.Record(t.String(), t.Any()) })

  .delete("/:clueId", async ({ params }) => {
    dbDeleteClue(params.id, params.clueId)
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
    const clue = dbGetClue(topicId, params.clueId)
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
      source_url: cur.raw_source?.urls?.[0] ?? cur.raw_source?.url ?? "",
      source_outlet: cur.source_credibility.origin_sources?.[0]?.outlet ?? cur.source_credibility.origin_source?.outlet ?? "",
      date: cur.timeline_date,
      clue_type: cur.clue_type,
    }

    try {
      const updated = await smartEditClue(topicId, topic.title, currentData, b.feedback.trim(), topic.models.enrichment)

      dbUpdateClueVersion(topicId, params.clueId, {
        title: updated.title,
        bias_corrected_summary: updated.summary,
        relevance_score: updated.relevance,
        party_relevance: updated.parties,
        timeline_date: updated.date,
        clue_type: updated.clue_type,
        domain_tags: updated.domain_tags ?? cur.domain_tags,
        source_credibility: {
          ...cur.source_credibility,
          score: updated.credibility,
          bias_flags: updated.bias_flags,
        },
      })

      return dbGetClue(topicId, params.clueId)
    } catch (e) {
      set.status = 500
      return { message: `Smart edit failed: ${e}` }
    }
  }, { body: t.Record(t.String(), t.Any()) })

  // Smart bulk import: fire-and-forget + poll
  .post("/bulk", async ({ params, body, error }) => {
    const b = body as { content: string; type?: string }
    if (!b.content?.trim()) return error(400, { message: "content is required" })
    const topicId = params.id

    if (!bulkImportJobs.has(topicId) || bulkImportJobs.get(topicId)!.status === "done" || bulkImportJobs.get(topicId)!.status === "error") {
      bulkImportJobs.set(topicId, { status: "running", imported: 0 })

      ;(async () => {
        try {
          const { getTopic } = await import("../pipeline/topicManager")
          const { smartExtractClues } = await import("../agents/SmartClueExtractor")
          const { dbGetParties } = await import("../db/queries/parties")
          const topic = await getTopic(topicId)
          const parties = dbGetParties(topicId)

          const extracted = await smartExtractClues(
            topicId, topic.title, topic.description,
            b.content, parties, topic.models.enrichment,
          )

          let count = 0
          for (const item of extracted) {
            const now = new Date().toISOString()
            const id = dbNextClueId(topicId)
            const urls = item.source_urls ?? (item.source_url ? [item.source_url] : [])
            const outlets = item.source_outlets ?? (item.source_outlet ? [item.source_outlet] : ["user"])
            const version: ClueVersion = {
              v: 1, date: now, title: item.title,
              raw_source: { urls, outlets, fetched_at: now },
              source_credibility: {
                score: item.credibility ?? 50,
                notes: `Source: ${outlets.join(", ") || "user-submitted"}`,
                bias_flags: item.bias_flags ?? [],
                origin_sources: urls.map((url: string, i: number) => ({
                  url, outlet: outlets[i] ?? "user", is_republication: false,
                })),
              },
              bias_corrected_summary: item.summary,
              relevance_score: item.relevance ?? 70,
              party_relevance: item.parties ?? [],
              domain_tags: item.domain_tags ?? [],
              timeline_date: item.date || now.slice(0, 10),
              clue_type: item.clue_type || "event",
              change_note: "Smart bulk import",
              key_points: item.key_points ?? [],
            }
            dbInsertClue(topicId, {
              id, current: 1, added_at: now, last_updated_at: now,
              added_by: "user", status: "verified", version,
            })
            count++
          }

          if (count > 0) await markStale(topicId)
          bulkImportJobs.set(topicId, { status: "done", imported: count })
        } catch (e) {
          bulkImportJobs.set(topicId, { status: "error", imported: 0, error: String(e) })
        }
      })()
    }

    return { status: bulkImportJobs.get(topicId)!.status }
  }, { body: t.Record(t.String(), t.Any()) })

  .get("/bulk/status", async ({ params }) => {
    const job = bulkImportJobs.get(params.id)
    if (!job) return { status: "none" }
    return job
  })

  // Research: user gives a direction → system searches, fetches, extracts clues
  .post("/research", async ({ params, body, error }) => {
    const { getTopic } = await import("../pipeline/topicManager")
    const { researchAndExtractClues } = await import("../agents/SmartClueExtractor")
    const { dbGetParties } = await import("../db/queries/parties")

    const b = body as { query: string }
    if (!b.query?.trim()) return error(400, { message: "query is required" })

    const topicId = params.id
    const topic = await getTopic(topicId)
    const parties = dbGetParties(topicId)

    const extracted = await researchAndExtractClues(
      topicId, topic.title, topic.description,
      b.query.trim(), parties, topic.models.enrichment,
    )

    const created: Clue[] = []
    for (const item of extracted) {
      const now = new Date().toISOString()
      const id = dbNextClueId(topicId)
      const urls = item.source_urls ?? (item.source_url ? [item.source_url] : [])
      const outlets = item.source_outlets ?? (item.source_outlet ? [item.source_outlet] : ["research"])
      const version: ClueVersion = {
        v: 1, date: now, title: item.title,
        raw_source: { urls, outlets, fetched_at: now },
        source_credibility: {
          score: item.credibility ?? 50,
          notes: `Research: ${b.query.slice(0, 60)}`,
          bias_flags: item.bias_flags ?? [],
          origin_sources: urls.map((url: string, i: number) => ({
            url, outlet: outlets[i] ?? "research", is_republication: false,
          })),
        },
        bias_corrected_summary: item.summary,
        relevance_score: item.relevance ?? 70,
        party_relevance: item.parties ?? [],
        domain_tags: item.domain_tags ?? [],
        timeline_date: item.date || now.slice(0, 10),
        clue_type: item.clue_type || "event",
        change_note: `Research query: ${b.query.slice(0, 80)}`,
        key_points: item.key_points ?? [],
      }
      dbInsertClue(topicId, {
        id, current: 1, added_at: now, last_updated_at: now,
        added_by: "research" as any, status: "verified", version,
      })
      const newClue = dbGetClue(topicId, id)
      if (newClue) created.push(newClue)
    }

    if (created.length > 0) await markStale(topicId)
    return { imported: created.length, clues: created, query: b.query }
  }, { body: t.Record(t.String(), t.Any()) })

  // Cleanup: categorize and propose consolidation groups (fire-and-forget + poll)
  .post("/cleanup/propose", async ({ params }) => {
    const topicId = params.id

    if (!cleanupJobs.has(topicId) || cleanupJobs.get(topicId)!.status === "done" || cleanupJobs.get(topicId)!.status === "error") {
      cleanupJobs.set(topicId, { status: "running", groups: null, original_count: 0 })

      ;(async () => {
        try {
          const { getTopic } = await import("../pipeline/topicManager")
          const { categorizeAndCleanup } = await import("../agents/SmartClueExtractor")
          const { dbGetParties } = await import("../db/queries/parties")
          const topic = await getTopic(topicId)
          const clues = dbGetClues(topicId)
          const parties = dbGetParties(topicId)

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
      return { status: "done", groups: job.groups, original_count: job.original_count }
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

    const idsToDelete = new Set<string>()
    const newClues: { id: string; version: ClueVersion }[] = []

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
          version: {
            v: 1, date: now, title: g.merged_title,
            raw_source: { urls: [], outlets: ["consolidated"], fetched_at: now },
            source_credibility: {
              score: g.merged_credibility ?? 60,
              notes: `Merged from ${g.source_clue_ids.length} clues`,
              bias_flags: g.merged_bias_flags ?? [],
              origin_sources: [{ url: "", outlet: "consolidated", is_republication: false }],
            },
            bias_corrected_summary: g.merged_summary,
            relevance_score: g.merged_relevance ?? 70,
            party_relevance: g.merged_parties ?? [],
            domain_tags: g.merged_domain_tags ?? [],
            timeline_date: g.merged_date || now.slice(0, 10),
            clue_type: g.merged_clue_type || "event",
            change_note: `Cleanup merge: ${g.reason}`,
            key_points: [],
          },
        })
      }
    }

    // Load current clues, filter out deleted/merged, add new merged ones, then re-number
    const allClues = dbGetClues(topicId)
    const filtered = allClues.filter(c => !idsToDelete.has(c.id))

    const renumbered: Clue[] = filtered.map((c, i) => ({
      ...c,
      id: `clue-${String(i + 1).padStart(3, "0")}`,
    }))

    const mergedClues: Clue[] = newClues.map((nc, i) => ({
      id: `clue-${String(renumbered.length + i + 1).padStart(3, "0")}`,
      current: 1,
      added_at: now,
      last_updated_at: now,
      added_by: "cleanup" as any,
      status: "verified" as const,
      versions: [nc.version],
    }))

    dbReplaceClues(topicId, [...renumbered, ...mergedClues])
    await markStale(topicId)

    const finalClues = dbGetClues(topicId)
    return {
      original_count: groups.reduce((sum: number, g: any) => sum + (g.source_clue_ids?.length || 0), 0),
      merged: newClues.length,
      deleted: idsToDelete.size - newClues.length,
      final_count: finalClues.length,
    }
  }, { body: t.Record(t.String(), t.Any()) })
