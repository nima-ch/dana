import { join } from "path"
import { queuedWrite } from "../../pipeline/writeQueue"
import type { ClueProcessorOutput } from "./clueProcessor"

export interface ClueVersion {
  v: number
  date: string
  title: string
  raw_source: {
    url: string
    fetched_at: string
    raw_text_file?: string
  }
  source_credibility: {
    score: number
    notes: string
    bias_flags: string[]
    origin_source: {
      url: string
      outlet: string
      is_republication: boolean
    }
  }
  bias_corrected_summary: string
  relevance_score: number
  party_relevance: string[]
  domain_tags: string[]
  timeline_date: string
  clue_type: string
  change_note: string
  key_points: string[]
}

export interface Clue {
  id: string
  current: number
  added_at: string
  last_updated_at: string
  added_by: "auto" | "user"
  versions: ClueVersion[]
  status: "raw" | "processing" | "verified" | "disputed"
}

export interface StoreClueInput {
  topicId: string
  title: string
  sourceUrl: string
  fetchedAt: string
  processed: ClueProcessorOutput
  partyRelevance?: string[]
  domainTags?: string[]
  timelineDate?: string
  clueType?: string
  addedBy?: "auto" | "user"
  changeNote?: string
}

export interface StoreClueResult {
  clue_id: string
  version: number
  status: "created" | "duplicate"
}

function generateClueId(existing: Clue[]): string {
  const next = existing.length + 1
  return `clue-${String(next).padStart(3, "0")}`
}

function cluesFilePath(topicId: string): string {
  const dataDir = process.env.DATA_DIR || "/home/nima/dana/data"
  return join(dataDir, "topics", topicId, "clues.json")
}

export async function storeClue(input: StoreClueInput): Promise<StoreClueResult> {
  const filePath = cluesFilePath(input.topicId)
  let result: StoreClueResult = { clue_id: "", version: 1, status: "created" }

  await queuedWrite<Clue[]>(
    input.topicId,
    filePath,
    (clues) => {
      // Deduplication: same URL + same timeline_date = duplicate
      const timelineDate = input.timelineDate || input.processed.date_references[0] || new Date().toISOString().slice(0, 10)
      const existing = clues.find(
        c => c.versions[c.current - 1]?.raw_source?.url === input.sourceUrl &&
             c.versions[c.current - 1]?.timeline_date === timelineDate
      )

      if (existing) {
        result = { clue_id: existing.id, version: existing.current, status: "duplicate" }
        return clues
      }

      const id = generateClueId(clues)
      const now = new Date().toISOString()

      const version: ClueVersion = {
        v: 1,
        date: now,
        title: input.title,
        raw_source: {
          url: input.sourceUrl,
          fetched_at: input.fetchedAt,
        },
        source_credibility: {
          score: input.processed.source_credibility_score,
          notes: input.processed.credibility_notes,
          bias_flags: input.processed.bias_flags,
          origin_source: input.processed.origin_source,
        },
        bias_corrected_summary: input.processed.bias_corrected_summary,
        relevance_score: input.processed.relevance_score,
        party_relevance: input.partyRelevance || [],
        domain_tags: input.domainTags || [],
        timeline_date: timelineDate,
        clue_type: input.clueType || "event",
        change_note: input.changeNote || "Initial version",
        key_points: input.processed.key_points,
      }

      const clue: Clue = {
        id,
        current: 1,
        added_at: now,
        last_updated_at: now,
        added_by: input.addedBy || "auto",
        versions: [version],
        status: "verified",
      }

      result = { clue_id: id, version: 1, status: "created" }
      return [...clues, clue]
    },
    []
  )

  return result
}
