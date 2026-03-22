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

  // Bulk import: text → extract clues, or urls → fetch+process
  .post("/bulk", async ({ params, body, error }) => {
    const { processClue } = await import("../tools/processing/clueProcessor")
    const { httpFetch } = await import("../tools/external/httpFetch")
    const { storeClue } = await import("../tools/processing/storeClue")
    const { getTopic } = await import("../pipeline/topicManager")

    const b = body as { type: "text" | "urls"; content: string }
    if (!b.content?.trim()) return error(400, { message: "content is required" })

    const topicId = params.id
    const topic = await getTopic(topicId)
    const topicContext = `${topic.title}: ${topic.description}`
    const created: Clue[] = []

    if (b.type === "urls") {
      const urls = b.content.split("\n").map(u => u.trim()).filter(Boolean)
      for (const url of urls.slice(0, 20)) {
        try {
          const fetched = await httpFetch(url, topicId)
          const processed = await processClue(fetched.raw_content, url, topicContext)
          if (processed.relevance_score < 20) continue
          const stored = await storeClue({
            topicId, title: fetched.title || url,
            sourceUrl: url, fetchedAt: fetched.fetched_at,
            processed, addedBy: "user",
          })
          if (stored.status === "created") {
            const clues = await readClues(topicId)
            const c = clues.find(cl => cl.id === stored.clue_id)
            if (c) created.push(c)
          }
        } catch { /* skip failures */ }
      }
    } else if (b.type === "text") {
      // Single LLM call to extract clues from pasted text
      const { chatCompletionText } = await import("../llm/proxyClient")
      const extractPrompt = `Extract distinct factual claims/events from this text as structured clues.

TEXT:
${b.content.slice(0, 10000)}

TOPIC: ${topicContext}

Output ONLY a JSON array:
[{"title":"<title>","summary":"<bias-corrected summary>","date":"<YYYY-MM-DD or unknown>","relevance":50-100,"parties":["<party_id>"]}]

Rules: each clue must be a distinct fact/event. Skip opinions without factual basis. Max 15 clues.`

      const raw = await chatCompletionText({
        model: topic.models.extraction,
        messages: [
          { role: "system", content: "You extract structured factual claims from text. Output ONLY valid JSON array." },
          { role: "user", content: extractPrompt },
        ],
        temperature: 0.2,
        max_tokens: 4000,
      })

      try {
        const match = raw.match(/\[[\s\S]+\]/)
        if (!match) throw new Error("No JSON array")
        const extracted = JSON.parse(match[0]) as { title: string; summary: string; date: string; relevance: number; parties: string[] }[]

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
                raw_source: { url: "", fetched_at: now },
                source_credibility: { score: 50, notes: "User-submitted bulk text", bias_flags: [], origin_source: { url: "", outlet: "user", is_republication: false } },
                bias_corrected_summary: item.summary,
                relevance_score: item.relevance,
                party_relevance: item.parties,
                domain_tags: [],
                timeline_date: item.date || now.slice(0, 10),
                clue_type: "event",
                change_note: "Bulk text import",
                key_points: [],
              }],
            }
            return [...clues, newClue!]
          }, [])
          if (newClue) created.push(newClue)
        }
      } catch { /* extraction failed */ }
    }

    if (created.length > 0) await markStale(topicId)
    return { imported: created.length, clues: created }
  }, { body: t.Record(t.String(), t.Any()) })
