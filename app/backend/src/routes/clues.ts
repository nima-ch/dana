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

  .delete("/:clueId", async ({ params }) => {
    await queuedWrite<Clue[]>(params.id, cluesPath(params.id),
      (clues) => clues.filter(c => c.id !== params.clueId), [])
    await markStale(params.id)
    return { success: true }
  })
